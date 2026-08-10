#!/usr/bin/env bash

set -Eeuo pipefail

readonly APP_DIR="/opt/coffee-shop-pos"
readonly DEPLOY_DIR="${APP_DIR}/deploy"
readonly SPA_DIR="/var/www/spa"

readonly COMPOSE_ENV_FILE="${APP_DIR}/.env"
readonly API_ENV_FILE="${DEPLOY_DIR}/api.env"

readonly SSM_PATH="/coffee-shop-pos/prod"

readonly SPA_BUCKET="${1:?Usage: remote-deploy.sh <spa-bucket> <api-image>}"
readonly API_IMAGE="${2:?Usage: remote-deploy.sh <spa-bucket> <api-image>}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "ERROR: This deployment script must run as root." >&2
  exit 1
fi

if [[ ! "$SPA_BUCKET" =~ ^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$ ]]; then
  echo "ERROR: Invalid S3 bucket name." >&2
  exit 1
fi

if [[ ! "$API_IMAGE" =~ ^([0-9]{12})\.dkr\.ecr\.([a-z0-9-]+)\.amazonaws\.com/[A-Za-z0-9._/-]+:[0-9a-f]{40}$ ]]; then
  echo "ERROR: API image must be an immutable private ECR SHA tag." >&2
  exit 1
fi

readonly ECR_REGISTRY="${BASH_REMATCH[1]}.dkr.ecr.${BASH_REMATCH[2]}.amazonaws.com"
readonly ECR_REGION="${BASH_REMATCH[2]}"

TEMP_COMPOSE_ENV="$(mktemp)"
readonly TEMP_COMPOSE_ENV

TEMP_API_ENV="$(mktemp)"
readonly TEMP_API_ENV

TEMP_COMPOSE="$(mktemp)"
readonly TEMP_COMPOSE

TEMP_NGINX="$(mktemp)"
readonly TEMP_NGINX

cleanup() {
  docker logout "$ECR_REGISTRY" >/dev/null 2>&1 || true

  rm -f \
    "$TEMP_COMPOSE_ENV" \
    "$TEMP_API_ENV" \
    "$TEMP_COMPOSE" \
    "$TEMP_NGINX"
}

trap cleanup EXIT

render_ssm_parameter() {
  local parameter_key="$1"
  local target_file="$2"
  local parameter_value
  local escaped_value

  if [[ ! "$parameter_key" =~ ^[A-Z][A-Z0-9_]*$ ]]; then
    echo "ERROR: Invalid environment key: $parameter_key" >&2
    return 1
  fi

  if ! parameter_value="$(
    aws ssm get-parameter \
      --name "${SSM_PATH}/${parameter_key}" \
      --with-decryption \
      --query "Parameter.Value" \
      --output text \
      --no-cli-pager
  )"; then
    echo "ERROR: Unable to retrieve ${SSM_PATH}/${parameter_key}." >&2
    return 1
  fi

  if [[ "$parameter_value" == *$'\n'* || "$parameter_value" == *$'\r'* ]]; then
    echo "ERROR: ${parameter_key} must be a single-line value." >&2
    return 1
  fi

  # Compose treats single-quoted values literally. Escape any embedded
  # single quote using the Compose-supported \' representation.
  escaped_value="${parameter_value//\'/\\\'}"

  printf "%s='%s'\n" \
    "$parameter_key" \
    "$escaped_value" \
    >> "$target_file"
}

readonly COMPOSE_PARAMETERS=(
  POSTGRES_USER
  POSTGRES_PASSWORD
  POSTGRES_DB
)

readonly API_PARAMETERS=(
  DATABASE_URL
  API_PORT
  WEB_ORIGIN
  JWT_SECRET
  AUTH_COOKIE_SAME_SITE
  AUTH_THROTTLE_MAX_FAILURES
  AUTH_THROTTLE_COOLDOWN_SECONDS
)

echo "== Prepare deployment directories =="

mkdir -p \
  "$APP_DIR" \
  "$DEPLOY_DIR" \
  "$SPA_DIR"

echo
echo "== Download deployment configuration =="

aws s3 cp \
  "s3://${SPA_BUCKET}/deploy-config/docker-compose.yml" \
  "$TEMP_COMPOSE" \
  --no-cli-pager

aws s3 cp \
  "s3://${SPA_BUCKET}/deploy-config/nginx.conf" \
  "$TEMP_NGINX" \
  --no-cli-pager

test -s "$TEMP_COMPOSE"
test -s "$TEMP_NGINX"

install \
  -o root \
  -g root \
  -m 0644 \
  "$TEMP_COMPOSE" \
  "${APP_DIR}/docker-compose.yml"

install \
  -o root \
  -g root \
  -m 0644 \
  "$TEMP_NGINX" \
  "${DEPLOY_DIR}/nginx.conf"

echo
echo "== Render Compose environment =="

umask 077

for parameter_key in "${COMPOSE_PARAMETERS[@]}"; do
  render_ssm_parameter \
    "$parameter_key" \
    "$TEMP_COMPOSE_ENV"
done

escaped_api_image="${API_IMAGE//\'/\\\'}"

printf "API_IMAGE='%s'\n" \
  "$escaped_api_image" \
  >> "$TEMP_COMPOSE_ENV"

echo
echo "== Render API runtime environment =="

for parameter_key in "${API_PARAMETERS[@]}"; do
  render_ssm_parameter \
    "$parameter_key" \
    "$TEMP_API_ENV"
done

install \
  -o root \
  -g root \
  -m 0600 \
  "$TEMP_COMPOSE_ENV" \
  "$COMPOSE_ENV_FILE"

install \
  -o root \
  -g root \
  -m 0600 \
  "$TEMP_API_ENV" \
  "$API_ENV_FILE"

echo "compose_environment=rendered"
echo "api_environment=rendered"
echo "ssm_parameter_count=$(( ${#COMPOSE_PARAMETERS[@]} + ${#API_PARAMETERS[@]} ))"

echo
echo "== Validate Docker Compose configuration =="

cd "$APP_DIR"

docker compose config --quiet

echo "compose_validation=passed"

echo
echo "== Authenticate to private ECR =="

aws ecr get-login-password \
  --region "$ECR_REGION" \
  --no-cli-pager |
docker login \
  --username AWS \
  --password-stdin \
  "$ECR_REGISTRY"

echo "ecr_authentication=passed"

echo
echo "== Pull deployment images =="

docker compose pull

echo
echo "== Apply production migrations =="

docker compose run \
  --rm \
  api \
  npm run db:migrate:deploy

echo
echo "== Start application services =="

docker compose up \
  -d \
  --remove-orphans \
  --wait \
  --wait-timeout 180

echo
echo "== Publish SPA =="

aws s3 sync \
  "s3://${SPA_BUCKET}/spa/" \
  "$SPA_DIR/" \
  --delete \
  --no-cli-pager

# index.html is the same byte size on every build (Vite's asset hashes are a
# fixed 8 chars), so sync's size-based diff can spuriously call it unchanged
# and skip it even though its content (the asset filenames it references)
# really did change. Force it unconditionally so the origin never serves a
# stale entry point while every hashed asset underneath it is current.
aws s3 cp \
  "s3://${SPA_BUCKET}/spa/index.html" \
  "$SPA_DIR/index.html" \
  --no-cli-pager

# The deployment process uses a restrictive umask for generated secret files.
# Static SPA files must remain readable and directories traversable by nginx.
find "$SPA_DIR" -type d -exec chmod 0755 {} +
find "$SPA_DIR" -type f -exec chmod 0644 {} +

test -s "${SPA_DIR}/index.html"

curl \
  --fail \
  --silent \
  --show-error \
  --output /dev/null \
  "http://127.0.0.1/"

echo "spa_origin=healthy"

echo
echo "== Verify local origin health =="

curl \
  --fail \
  --silent \
  --show-error \
  --retry 10 \
  --retry-delay 3 \
  --retry-all-errors \
  "http://127.0.0.1/health"

echo
echo
echo "== Deployment status =="

docker compose ps

echo
echo "remote_deployment=passed"
echo "api_image=${API_IMAGE}"
