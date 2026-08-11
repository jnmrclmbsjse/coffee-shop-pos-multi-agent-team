# Deployment — AWS Go-Live Runbook

Status: **code complete, not yet applied to AWS**. This is the living reference
for taking the Coffee Shop POS to production on AWS, and for the autonomous
deploy lane that keeps it there. Update the checklists below as items land;
don't let this file drift from reality.

Related: [ADR 0001](../docs/adr/0001-initial-stack.md) (hosting shape origin),
[ADR 0009](../docs/adr/0009-deployment-architecture.md) (this decision — accepted).

---

## 0. Implementation status

What exists in the repo today vs. what still requires hands-on, real-AWS work.

**Done**
- [x] This runbook (`infra/DEPLOYMENT.md`) and [ADR 0009](../docs/adr/0009-deployment-architecture.md).
- [x] App-code prerequisites filed as issue **#235** (Dockerfile/`prisma/` +
  `migrate deploy` blocker, `helmet`, `trust proxy`, guard audit) — routes
  through the existing `agent:dev` lane; not yet fixed.
- [x] Pulumi program in `infra/` (`network.ts`, `iam.ts`, `storage.ts`,
  `compute.ts`, `edge.ts`, `oidc.ts`, `index.ts`) — typechecks clean against
  real `@pulumi/aws` types, **never applied** (no AWS account attached yet).
  Two OIDC roles: `deployRole` (narrow, app deploys) and `infraRole` (broader,
  infra changes — see §5).
- [x] `docker-compose.yml` + `deploy/nginx.conf` — validated with
  `docker compose config`.
- [x] `.github/workflows/deploy.yml` — the app deploy pipeline (OIDC, build,
  migrate via SSM, health gate). Written, not yet run (needs the repo
  variables listed in §7, which don't exist until `infra/` is applied once).
- [x] `.github/workflows/infra.yml` — runs `pulumi preview`/`up` in CI via
  OIDC for every infra change *after* the one-time bootstrap (§5a). Written,
  not yet run.
- [x] Agentic wiring: `agent:deploy` label/lane in `scripts/poll.sh`,
  `scripts/deploy.sh`, `prompts/deploy.md`, the Release/Deploy role in
  `CLAUDE.md`, and `prompts/qa-test.md`'s hand-off on QA pass — all code
  complete, exercised only via syntax checks (`bash -n`), not a live run.
- [x] `infra/Dockerfile.bootstrap` — the one-time bootstrap environment
  (replaces an earlier AWS CloudShell attempt that hit that environment's
  storage quota — see §5a). Built and smoke-tested locally: `pulumi version`,
  `aws --version`, and `npm ci && npx tsc --noEmit` against the real
  `infra/` project all pass inside the container.

- [x] **Bootstrap apply (§5a) succeeded 2026-08-03**, via
  `infra/Dockerfile.bootstrap` — real AWS resources now exist (EC2, S3,
  CloudFront, WAF, both OIDC roles). Along the way this surfaced and fixed
  three real bugs, all logged in §5a's troubleshooting notes: a dead
  `config.require("region")` call reading the wrong config namespace, a
  hand-transcribed GitHub OIDC thumbprint that was the wrong length (now
  fetched live via `@pulumi/tls` instead of hardcoded), and a non-ASCII
  em dash in a security group description (AWS's `GroupDescription` is
  ASCII-only).

**Not done — genuinely needs the operator, not an agent**
- [ ] Fix the app-code prerequisites (issue #235) via the normal Dev pickup.
- [ ] Delete the bootstrap access key (§5a step G) — it's no longer needed
  now that the bootstrap apply succeeded.
- [ ] Set the GitHub Actions repository variables/secret it unlocks (§5a/§7).
- [ ] Generate and store real production secrets in SSM (§3).
- [ ] Run the first deploy, seed admin/staff, verify sign-in end-to-end (§9).
- [ ] Set up nightly backups and run a rollback drill.

None of the "not done" items are things an agent should do unattended — they
either cost real money, require an AWS account/credentials only the operator
holds, or are the first real trial of a rollback/restore path that's worth
watching happen rather than delegating.

---

## 1. Why this shape

The app is two deployables (NestJS API, static Vite SPA) plus Postgres, used by
**at most 3 people** (single shop, one more branch planned later). Every choice
below optimizes for lowest sane cost and maximum learning value over
best-practice-at-scale — load balancing, autoscaling, multi-AZ, and managed
HA are deliberately **not** done here; each section says what you'd do instead
if this ever needed to scale.

| Decision | Choice | Trade-off accepted |
|---|---|---|
| Compute | Single EC2 `t4g.small` (Graviton), Docker Compose | No HA/managed backups; we own OS patching + backups. Single point of failure — acceptable for 3 internal users. |
| Region | `ap-southeast-1` (Singapore) | Chosen for a Philippines-based shop — lowest-latency mature AWS region for dynamic API calls from there. The WAF WebACL still pins to `us-east-1` regardless (a CloudFront-only AWS quirk), isolated behind its own provider alias in `infra/edge.ts` — unaffected by this choice. Set in `infra/Pulumi.prod.yaml`, not hardcoded in the Pulumi program. |
| Edge / TLS | CloudFront default `*.cloudfront.net` + AWS WAF | ~$5–10/mo for WAF; no vanity URL yet. |
| IaC | Pulumi (TypeScript) | Less industry-ubiquitous than Terraform, but same language as the rest of the repo — least context-switch for this team. |
| Deploy trigger | Agent triggers GitHub Actions (OIDC) | One pipeline to build up front; gains reproducibility, audit trail, no long-lived AWS keys anywhere. |
| Domain | None yet | Revisit for ~$12/yr when a vanity URL matters; would also unlock Cloudflare's free WAF/DDoS tier as an alternative edge. |

**Cost estimate:** EC2 t4g.small ~$12/mo (or t4g.micro on free tier, RAM-tight)
+ EBS ~$2 + WAF ~$6 + CloudFront/S3/SSM pennies ≈ **$15–25/mo** (~$8–12/mo on
free tier). The usual AWS cost trap — a NAT Gateway (~$32/mo alone) — is
avoided entirely by using the default VPC's public subnet with a locked-down
security group instead of a private subnet.

---

## 2. Target architecture

```
Browser
  │  HTTPS (CloudFront's cert satisfies the Secure cookie flag)
  ▼
CloudFront (default *.cloudfront.net cert)
  + AWS WAF WebACL: AWS managed common ruleset + rate-based rule (e.g. 1000 req / 5 min / IP)
  │  cache: SPA static assets = cached;  /api/* = CachingDisabled, forward Cookie + all methods
  ▼
EC2 t4g.small  (public subnet, DEFAULT VPC — no NAT gateway, no SSH inbound)
  Security Group: inbound :80 ONLY from the AWS-managed CloudFront prefix list; egress open
  Managed exclusively via AWS SSM Session Manager (instance role) — port 22 closed
  ├─ nginx        → serves the SPA at  /   ;  proxies  /api/*  → api:3000  (strips /api prefix)
  ├─ API container (:3000, `node dist/main.js`)
  └─ Postgres container (data on a persistent EBS volume)
```

**Why same-origin:** the SPA and API share one origin — the CloudFront domain.
The SPA is built with `VITE_API_URL=/api` (a **relative** path, not baked to any
absolute host). This removes CORS entirely and lets the `ucm_admin_session`
auth cookie stay `SameSite=Lax; Secure; HttpOnly` — the strongest posture
achievable without extra work. Cross-origin (`SameSite=None`) is only needed if
SPA and API ever live on different hosts — avoid that scenario if possible.

**SPA cache rule:** nginx sends `Cache-Control: no-cache` on `index.html`,
including when a client-side deep link falls back to that entry document. The
entry document must therefore be revalidated rather than reused at the edge;
otherwise CloudFront can retain a different stale build for every deep-link
path. Do not apply this rule to `/assets/`: Vite's content-hashed assets should
remain long-lived and cacheable. Each deployment also invalidates `/*` once to
clear entry documents cached under deep paths by older deployments.

**If this ever needs to scale past ~3 users:** move Postgres to RDS (managed
backups/patching), API to ECS Fargate behind an ALB (horizontal scaling, but
note the login throttle is in-memory per-instance — see §7), and add a NAT
gateway or VPC endpoints for private-subnet egress. None of that is needed today.

---

## 3. Secrets & configuration

All production secrets live in **AWS SSM Parameter Store** as `SecureString`
values (standard parameters are free — no Secrets Manager cost). The EC2
instance role has read access scoped to this app's parameter path only.
Nothing sensitive is committed to git or stored on any laptop.

| Parameter | Purpose | Source of truth |
|---|---|---|
| `/coffee-shop-pos/prod/JWT_SECRET` | JWT signing (≥32 chars, enforced by `apps/api/src/auth/auth.module.ts`) | generated once, stored only in SSM |
| `/coffee-shop-pos/prod/DATABASE_URL` | Postgres connection string | generated once (strong password — never `postgres:postgres`) |
| `/coffee-shop-pos/prod/SEED_ADMIN_USERNAME` / `SEED_ADMIN_PASSWORD` | first admin account (seed-only provisioning per ADR 0002) | operator-chosen, strong password |
| `/coffee-shop-pos/prod/SEED_STAFF_USERNAME` / `SEED_STAFF_PASSWORD` / `SEED_STAFF_PIN` | first staff account | operator-chosen; **do not use the default PIN `0000`** |
| `/coffee-shop-pos/prod/WEB_ORIGIN` | CORS allowlist (defensive — same-origin makes this moot, but the API still enforces it) | the CloudFront domain |
| `AUTH_COOKIE_SECURE` | must be unset/true in prod (defaults secure unless explicitly `false`) | compose env, not a secret |
| `AUTH_COOKIE_SAME_SITE` | `lax` (same-origin deploy) | compose env, not a secret |

At deploy time, the EC2 instance renders these into the compose env file by
reading SSM (see `deploy.yml` §5). Account provisioning is **seed-only** — there
is no account-management UI (ADR 0002 explicit stopgap); to add/change a
user, update the seed env values in SSM and re-run the seed (idempotent via
`upsert`, safe to re-run).

---

## 4. Go-live prerequisite checklist

### App-code prerequisites (route to Tech Lead → Dev; the deploy agent is read-only on app code)

- [ ] **Blocker:** `apps/api/Dockerfile` does not copy the `prisma/` directory
  into the runtime image, and there is no `migrate deploy` script anywhere in
  `apps/api/package.json` (only `db:migrate` = `prisma migrate dev`, a dev-only
  command). **Migrations cannot run in the container as it exists today.** Fix:
  add `prisma/` to the runtime stage and add a `db:migrate:deploy` script
  (`prisma migrate deploy`).
- [ ] Add `helmet` to `apps/api/src/main.ts` (no security headers today).
- [ ] Add `app.set('trust proxy', 1)` in `main.ts` — behind CloudFront,
  `X-Forwarded-Proto` must be trusted for `secure` cookies to behave correctly.
- [ ] Audit that every sensitive controller (orders, sales, catalog, inventory,
  reporting, staff, trading-day) declares `@UseGuards(JwtAuthGuard, RolesGuard)`
  — there is **no global guard fallback**, so an unguarded controller is
  unauthenticated by default. Consider adding a global guard with explicit
  `@Public()` opt-outs instead of the current per-controller-only model.
- [ ] Confirm the SPA build step passes `VITE_API_URL=/api` — Vite does **not**
  read the repo-root `.env` (it only reads `apps/web/.env*`), so this must be
  set explicitly in the build environment (see `deploy.yml`), not assumed from
  the root `.env`.

### Ops/config prerequisites

- [ ] Generate a strong `JWT_SECRET` (≥32 chars) → SSM SecureString.
- [ ] Strong Postgres password (replace the dev default `postgres:postgres`) → SSM.
- [ ] Strong `SEED_ADMIN_PASSWORD` and a real staff PIN (replace default `0000`).
- [ ] Set prod cookie flags: do not set `AUTH_COOKIE_SECURE=false`; keep
  `AUTH_COOKIE_SAME_SITE=lax`; `WEB_ORIGIN` = the CloudFront domain.
- [ ] Confirm the committed root `.env` holds no real secret (it currently only
  has dev placeholders) — `.dockerignore` already excludes `.env*` from images.
- [ ] Run the first-boot seed once after migrations (`prisma/seed.ts`; idempotent).
- [ ] Nightly `pg_dump` → S3 backup via a systemd timer on the box; document and
  run a restore test (see §8).

### Governance

- [ ] Tech Lead writes **ADR 0009 — Deployment Architecture**, recording this
  decision and its trade-offs (Tech Lead owns `docs/adr/`).
- [ ] Note: ADRs 0003–0008 remain "Proposed" (never formally accepted) — flag to
  PO/Tech Lead as a process gap; not a hard blocker for deploying the parts that
  are already shipped and QA-accepted.

---

## 5. Infrastructure as code (`infra/`, Pulumi TypeScript)

Pulumi project provisioning, in the default VPC (no custom networking needed
at this scale):

- EC2 `t4g.small` + an IAM instance profile granting: SSM managed-instance core
  (for Session Manager — no SSH), read access to this app's SSM parameter path,
  and S3 read on the SPA/backup buckets.
- Security group: inbound `:80` only from the **AWS-managed CloudFront prefix
  list** (`com.amazonaws.global.cloudfront.origin-facing`); no inbound `:22`.
  All administration is via SSM Session Manager.
- S3 buckets: one for the SPA static build (private, CloudFront-only read via
  OAC), one for nightly Postgres backups.
- CloudFront distribution: default cert, one origin (the EC2/nginx), cache
  policy caching SPA assets and bypassing `/api/*` (forward `Cookie` header +
  all HTTP methods to preserve auth + writes).
- AWS WAF WebACL attached to the CloudFront distribution: AWS Managed Common
  Rule Set + a rate-based rule (start at ~1000 req/5min/IP; tune down if abuse
  is observed — this is the primary defense against cost-ramp from an exploit
  or crawler).
- SSM `SecureString` parameters (see §3) — created here or seeded once manually
  and referenced by name, operator's call at execution time.
- GitHub OIDC identity provider + **two** scoped IAM roles, both trusted only
  for this repo + the `master` branch, holding no long-lived AWS keys:
  - `deployRole` — narrow, used by `.github/workflows/deploy.yml` for every
    app deploy (upload the SPA build, run one SSM command).
  - `infraRole` — broader, used by `.github/workflows/infra.yml` for every
    infra change after the bootstrap apply below (it needs to create/modify
    EC2, IAM, S3, CloudFront, and WAF resources, since that's what standing
    up or changing this stack means). See `infra/oidc.ts` for the accepted
    trade-off note on this role's IAM scope.

### 5a. Bootstrap (one-time, not repeatable through CI)

`infra.yml` can only assume `infraRole` via GitHub OIDC if that OIDC provider
already exists in AWS — but creating it is itself one of the things the very
first `pulumi up` does. Something has to authenticate that one bootstrap run
differently.

**Chosen approach: a throwaway local Docker container** (`infra/Dockerfile.bootstrap`),
built and run once on the operator's machine, using a short-lived IAM access
key that's deleted right after. We tried AWS CloudShell first — it kept
hitting that environment's tiny (~1 GB) persistent-storage quota (see the
superseded troubleshooting log at the bottom of this section for the full
trail) — so this replaced it. The container is ephemeral (`docker run --rm`)
and the only thing that persists afterward is what actually lands in AWS and
Pulumi Cloud; nothing is installed on the host beyond Docker itself, which was
already there.

**A. Create a dedicated IAM admin user (one-time, do not use root day-to-day)**

1. Sign in to the AWS Console as the **root user** (only for this step).
2. Go to **IAM → Users → Create user**. Name: `bootstrap-admin`. Check
   "Provide user access to the AWS Management Console" and set a password
   (console access isn't strictly needed for the Docker path, but is handy
   for looking at the account in a browser).
3. Permissions: attach the AWS-managed policy **`AdministratorAccess`**
   directly (this is a solo-operator account, not a shared enterprise one —
   see the accepted trade-off note in `infra/oidc.ts`).
4. Finish creating the user. **Turn on MFA for this user** (IAM → Users →
   `bootstrap-admin` → Security credentials → Assign MFA device — an
   authenticator app on your phone is the quickest option).
5. **Sign out of the root user.** Root stays locked away from here on.
6. On the same user, go to **Security credentials → Access keys → Create
   access key**, use case "Command Line Interface (CLI)", acknowledge the
   warning, create it, and copy both the **Access Key ID** and **Secret
   Access Key** (shown once). This key is used only as an env var for the
   container run in step D — never written to a file, never committed — and
   gets deleted in step G once bootstrap succeeds.

**B. Get a Pulumi Cloud account + token**

1. Sign up free at [app.pulumi.com](https://app.pulumi.com) (or log in with
   GitHub).
2. Go to **Account (your avatar, top right) → Personal Access Tokens → Create
   token** (NOT "OIDC issuers" — that's a different feature, for letting
   Pulumi Cloud trust other systems via OIDC). Name it e.g.
   `coffee-shop-pos-bootstrap`, copy the value — you'll use it in step D, and
   again later as a GitHub Actions secret (§7).

**C. Build the bootstrap image**

```sh
cd infra
docker build -f Dockerfile.bootstrap -t coffee-shop-pos-bootstrap .
```

This installs Node (from the `node:24-bookworm` base), Pulumi CLI, and AWS CLI
into a throwaway image — nothing here touches the host.

**D. Run it, mounting `infra/` straight from your machine**

```sh
docker run -it --rm \
  -v "$(pwd):/workspace" \
  -e AWS_ACCESS_KEY_ID=<paste from step A.6> \
  -e AWS_SECRET_ACCESS_KEY=<paste from step A.6> \
  -e AWS_DEFAULT_REGION=ap-southeast-1 \
  -e PULUMI_ACCESS_TOKEN=<paste from step B> \
  coffee-shop-pos-bootstrap bash
```

You're now in a shell inside the container, with `infra/` mounted at
`/workspace` (so `npm install` there also updates the lockfile on your host —
that's expected and fine to commit afterward).

**E. Verify identity, then apply**

```sh
aws sts get-caller-identity     # confirm this is bootstrap-admin, not root
pulumi login                   # picks up PULUMI_ACCESS_TOKEN — no interactive prompt
npm ci
pulumi stack init prod
pulumi up                      # review the full diff, then type "yes" to confirm
```

`pulumi up` shows everything it's about to create before creating anything —
read it once before confirming. This is also the point real AWS cost starts
accruing (~$15–25/mo, §1).

**F. Wire the outputs into GitHub**

```sh
pulumi stack output
```

Set these as **GitHub repo variables** (Settings → Secrets and variables →
Actions → Variables): `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN` (=
`githubDeployRoleArn`), `AWS_INFRA_ROLE_ARN` (= `githubInfraRoleArn`),
`EC2_INSTANCE_ID` (= `ec2InstanceId`), `SPA_BUCKET` (= `spaBucketName`),
`API_REPOSITORY_URL` (= `apiRepositoryUrl`), `SITE_URL` (= `siteUrl`),
`CLOUDFRONT_DISTRIBUTION_ID` (= `cloudfrontDistributionId`). And one
**secret**: `PULUMI_ACCESS_TOKEN` (the same token from step B).

**G. Tear down the bootstrap credential**

Exit the container (`exit` — it's `--rm`, so it's already gone). Back in the
AWS Console: **IAM → Users → `bootstrap-admin` → Security credentials →
Access keys → Delete** the key created in step A.6. It was only ever needed
for this one run — every infra change from now on authenticates via OIDC
through `.github/workflows/infra.yml`, not this key. (Keep the
`bootstrap-admin` *user* itself — it's your one standing console-login admin
account, protected by its password + MFA, not something to delete.)

**After this one run, never install anything locally again** — every future
infra change goes through `.github/workflows/infra.yml`
(`workflow_dispatch`, `preview`/`up`), and every app deploy through
`.github/workflows/deploy.yml`, both via OIDC.

**State backend note:** `pulumi login` with a Pulumi Cloud token is the state
store — no S3 bucket to bootstrap, no locking to manage by hand. The
trade-off (state lives with a third party, not inside your AWS account) is
accepted for this scale; a self-managed S3 backend is the AWS-native
alternative if that's ever revisited.

**Troubleshooting note — the real root cause of the whole earlier CloudShell
mystery, found once Docker actually surfaced the real error:**
`error: Missing required configuration variable
'coffee-shop-pos-infra:region'`. A genuine bug in `infra/config.ts`: it had
`const config = new pulumi.Config();` — with **no** namespace argument,
`pulumi.Config()` defaults to the **current project's own** namespace
(`coffee-shop-pos-infra`, from `Pulumi.yaml`'s `name:`), not the `aws:`
namespace. So `config.require("region")` was looking for a
`coffee-shop-pos-infra:region` key that was never set — only `aws:region` was
ever set (a completely different namespace), and the AWS provider already
resolves `aws:region` on its own for every resource, so this export served no
purpose. This is almost certainly the exact same crash that produced
CloudShell's generic `Program exited with non-zero exit code: -1` all along —
CloudShell's `pulumi up` just never surfaced the real message the way Docker
did. Fix applied: deleted the dead `awsRegion` export from `config.ts`
entirely.

**Troubleshooting note — invalid GitHub OIDC thumbprint:**
`error: ... expected length of thumbprint_list.0 to be in the range (40 -
40), got 6938fd4d98bab03faadb97b34396831e3780aea` — that hardcoded value in
`infra/oidc.ts` was hand-transcribed from memory and turned out to be only 39
characters (a SHA-1 thumbprint must be exactly 40 hex chars) — exactly the
"verify it is still current" risk the code comment had already flagged, just
realized as a length error instead of a content one. Rather than guess a
corrected value for a security trust anchor, fixed properly: added
`@pulumi/tls` and now fetch the live certificate's thumbprint at apply time
via `tls.getCertificateOutput({ url: "https://token.actions.githubusercontent.com" })`
— the same method AWS's docs describe doing manually via `openssl`, done as
code instead of a hardcoded string. This also means it self-updates if
GitHub ever rotates the certificate again.

**Troubleshooting note — non-ASCII character in a security group description:**
`error: ... Value (Coffee Shop POS origin — HTTP from CloudFront only, no
SSH) for parameter GroupDescription is invalid. Character sets beyond ASCII
are not supported.` — the em dash (`—`) in `infra/network.ts`'s security
group `description` field tripped this; several other files use the same
character but only in code comments (harmless) — this was the one place it
ended up inside an actual AWS resource argument. Fixed by using a plain
hyphen instead. Swept every `.ts` file afterward for any other non-ASCII
character inside a string literal (not just em dashes) — none found.

**Bootstrap log** — fill in after running the steps above:

| Item | Value | Date |
|---|---|---|
| `bootstrap-admin` IAM user created | done | 2026-08-03 |
| Pulumi Cloud account / token created | done | 2026-08-03 |
| `pulumi up` applied successfully | done — via `infra/Dockerfile.bootstrap` | 2026-08-03 |
| Existing GitHub repo variables set | done — `AWS_REGION`, `AWS_DEPLOY_ROLE_ARN`, `AWS_INFRA_ROLE_ARN`, `EC2_INSTANCE_ID`, `SPA_BUCKET`, `SITE_URL` | 2026-08-03 |
| `API_REPOSITORY_URL` repo variable set | pending — set from `apiRepositoryUrl` after the ECR Pulumi update is applied | — |
| `CLOUDFRONT_DISTRIBUTION_ID` repo variable set | pending — set from `cloudfrontDistributionId` after the CloudFront-invalidation Pulumi update is applied | — |
| `PULUMI_ACCESS_TOKEN` secret set | done | 2026-08-03 |
| Bootstrap access key deleted (step G) | done | 2026-08-03 |

<details>
<summary>Superseded: AWS CloudShell troubleshooting trail (kept for the record)</summary>

The original approach was AWS CloudShell (signed in as `bootstrap-admin`, a
browser shell with no local install). It surfaced several real, worth-keeping
gotchas before we hit a wall that motivated switching to Docker:

- `could not unmarshal '.../Pulumi.yaml': Configuration key 'aws:region' is
  not namespaced by the project and should not define a default value` — a
  provider-namespaced key (like `aws:region`) can't declare a project-level
  `default:` in `Pulumi.yaml`, and a project-level `value:` can't be
  overridden per stack either. Fix applied (still true today): `aws:region`
  is set only in `infra/Pulumi.prod.yaml`, not in `infra/Pulumi.yaml` at all.
- The Pulumi Cloud access-token page is **Account → Personal Access
  Tokens**, not "OIDC issuers" (a different feature).
- `npm error code ENOSPC` and a generic `pulumi up` crash (`Program exited
  with non-zero exit code: -1`), traced via `df -h` to
  **`/home/cloudshell-user` being its own separate, fixed ~1 GB loopback
  volume** — the `pulumi` CLI (~344 MB) and `@pulumi/aws` plugin (~350 MB)
  alone nearly fill it, and once it hits 0 bytes free, even
  `npm config set --global` silently fails to persist (it needs to write
  `~/.npmrc`). Redirecting both tools via `PULUMI_HOME=/tmp/...` and
  `NPM_CONFIG_CACHE=/tmp/...` worked around it.
- After the storage fix, `pulumi up` still crashed identically. We ruled out,
  in order: missing stack config (`pulumi config` showed it was all present),
  no default VPC in `ap-southeast-1` (confirmed present via
  `aws ec2 describe-vpcs --filters Name=is-default,Values=true`), and a
  CLI/SDK version mismatch (both were `3.255.0`, in sync). The real cause was
  never conclusively found — `pulumi up --debug` was the next step when we
  switched to Docker instead, both to escape the storage ceiling and to stop
  burning time on an environment-specific mystery rather than the actual
  infrastructure.

</details>

---

## 6. `docker-compose.yml` + nginx (on the box)

Three services: `api` (the published image, reads env from the rendered file),
`db` (Postgres, EBS-backed volume), and `nginx` (serves the SPA static files at
`/`, reverse-proxies `/api/*` to `api:3000` stripping the `/api` prefix). Compose
file lives at repo root; nginx config at `deploy/nginx.conf`.

---

## 7. GitHub Actions deploy pipeline (`.github/workflows/deploy.yml`)

Triggered by the deploy agent via `gh workflow run deploy.yml --ref master`
(also available as manual `workflow_dispatch`). Steps:

1. Assume the AWS deployer IAM role via **GitHub OIDC** — no stored AWS keys.
2. Authenticate to the private Amazon ECR registry and build the API image for
   `linux/arm64`.
3. Push the image to the private ECR repository using the immutable Git commit
   SHA as its tag.
4. Build the SPA with `VITE_API_URL=/api`; upload the static bundle to
   `s3://<spa-bucket>/spa/`.
5. Upload `docker-compose.yml`, `deploy/nginx.conf`, and
   `deploy/remote-deploy.sh` to `s3://<spa-bucket>/deploy-config/`.
6. Run `deploy/remote-deploy.sh` on the EC2 instance using **AWS SSM Run
   Command**. The script:
   - downloads the deployment configuration from S3;
   - renders Compose and API environment files from SSM SecureString
     parameters;
   - authenticates Docker to private ECR using the EC2 instance role;
   - validates the Compose configuration;
   - runs `docker compose pull`;
   - runs `docker compose run --rm api npm run db:migrate:deploy`;
   - starts the services with `docker compose up --wait`;
   - syncs `s3://<spa-bucket>/spa/` to `/var/www/spa`; and
   - verifies the local nginx `/health` endpoint.
7. Fail the workflow unless the SSM command explicitly reaches `Success`, then
   invalidate `/*` on CloudFront so entry documents cached under deep-link
   paths by an older deployment cannot survive the release.
8. Verify the live uncached endpoint at `<site-url>/api/health`.

**Rollback:** every image is tagged by git sha. Rolling back is one SSM Run
Command re-running compose with the previous sha's image tag, then re-syncing
the previous SPA build from a retained S3 version (bucket versioning enabled).
No infra change needed for a rollback — document the exact commands here once
the pipeline exists.

**Note on single-instance throttle:** `AuthAttemptThrottleService` keeps failed
login state in an in-process `Map`. Because there is exactly one API instance
in this shape, that's correct — this stops being true if the API is ever
horizontally scaled (see §2's scale-up note), at which point the throttle
would need shared state (e.g. Redis) to keep working across instances.

---

## 8. Autonomous deploy lane (agentic pipeline integration)

Mirrors the existing `scripts/poll.sh` orchestration pattern (see
`prompts/_conventions.md` for the shared completion-marker/self-report
protocol every agent role already follows).

**New role — Release/Deploy agent** (Claude-run, `as_human` GitHub identity).
Charter lives in `CLAUDE.md`. Boundaries: may write to `infra/`,
`.github/workflows/deploy.yml`, and this file; **read-only on application
code** — any app-code prerequisite it finds missing gets filed/relabeled to
Tech Lead rather than fixed directly.

**New `poll.sh` lane `deploy`**, modeled on the existing `poll_adr` lane (which
already watches external state — a PR — to resume work; this lane watches a
GitHub Actions run instead):

- `scripts/setup/01-labels.sh`: `agent:deploy` label.
- `scripts/setup/03-project-fields.sh`: Status values `Ready for Deploy`,
  `Deploying`, `Deployed` inserted between `QA Accepted` and `Done`.
- `scripts/poll.sh`: `deploy` added to `label_for` (→ `agent:deploy`),
  `script_for` (→ `scripts/deploy.sh`), `single_for` (→ `1`, exclusive —
  only one deploy runs at a time).
- `scripts/deploy.sh`: thin wrapper mirroring `scripts/qa-test.sh` — source
  `_common.sh`, `as_human`, `require_claude_auth`, then
  `$CLAUDE_EXEC "$(render deploy.md "$ISSUE")"`.
- `prompts/deploy.md`, following `prompts/_conventions.md`'s marker/rule-B
  failure protocol:
  1. Verify the go-live prerequisite checklist (§4) is green. If an app-code
     prerequisite is missing, **do not deploy** — relabel/comment to Tech Lead
     and stop (rule-B: no `:done` marker, post an error comment, exit non-zero).
  2. Compute master's HEAD sha; if it matches the last recorded `Deployed` sha,
     no-op ("already live") — avoids redundant deploys when multiple stories
     land QA in the same cycle.
  3. `gh workflow run deploy.yml --ref master`, then poll the run to completion
     (same external-state-watch shape as `poll_adr`).
  4. On a green run: `curl` the `/health` endpoint for 200, set the story to
     `Deployed`, comment the deployed sha, self-report via `gh`.
  5. On a red run: post the failing step's log tail; relabel `agent:dev` if the
     failure is a migration/app error, or `agent:human` if it's infra — never
     loop past the existing `MAX_DISPATCHES` cap.

**Trigger:** on QA pass, `prompts/qa-test.md` sets the story to `Ready for
Deploy` + `agent:deploy` instead of the current manual seam (QA Accepted → a
human manually sets Done). All of `poll.sh`'s existing guards — the `mkdir`
lock, `MAX_DISPATCHES`, `MAX_PER_HOUR`, the auth-exit-3 halt, `agent:human`
escalation — apply automatically once this lane routes through `dispatch`; none
of that needed to be rebuilt.

**Direct-to-production** is intentional per the operator's decision — this is
an internal tool with ≤3 users, and the health-check gate + rollback path are
judged sufficient safety net without a separate staging environment.

---

## 9. Verification checklist (run once the pipeline exists)

- [ ] `pulumi preview` / `pulumi up` completes clean.
- [ ] CloudFront serves the SPA over HTTPS at its default domain.
- [ ] The EC2 instance is unreachable directly (security group lock confirmed
  — attempt a direct HTTP request to the instance's public IP and see it time out).
- [ ] No port `22` is open; SSM Session Manager is the only working shell path.
- [ ] A burst of requests (e.g. via `hey` or `ab`) trips the WAF rate rule.
- [ ] The auth cookie inspected in the browser reads
  `Secure; HttpOnly; SameSite=Lax`.
- [ ] `gh workflow run deploy.yml` completes green; `prisma migrate deploy`
  applied all existing migrations; the SPA is synced; `/health` returns 200.
- [ ] Existing Playwright specs (`e2e/admin-signin.spec.ts`,
  `e2e/staff-signin.spec.ts`) pass against the live CloudFront URL — admin
  login, staff password login, staff PIN login, session persistence across
  reload.
- [ ] Move a test story to `QA Accepted` and confirm the `deploy` lane picks it
  up, triggers + watches the Action, and sets `Deployed` with the correct sha —
  and that a second pass with no new commits correctly no-ops.
- [ ] Rollback drill: deploy sha `N+1`, roll back to `N` via the documented SSM
  command, confirm `/health` and sign-in both work post-rollback.

---

## 10. Files (reference)

- **Created by this effort:** `infra/DEPLOYMENT.md` (this file), `infra/`
  (Pulumi project), `infra/Dockerfile.bootstrap` (one-time bootstrap
  environment), `docker-compose.yml`, `deploy/nginx.conf`,
  `.github/workflows/deploy.yml`, `.github/workflows/infra.yml`,
  `scripts/deploy.sh`, `prompts/deploy.md`,
  `docs/adr/0009-deployment-architecture.md`.
- **Modified:** `scripts/poll.sh`, `scripts/setup/01-labels.sh`,
  `scripts/setup/03-project-fields.sh`, `CLAUDE.md` (Deploy role charter),
  `prompts/qa-test.md` (hand-off to `agent:deploy`), `apps/api/Dockerfile` +
  `apps/api/package.json` (prisma dir + `migrate deploy` script).
- **Reused, not reinvented:** `poll.sh`'s `label_for`/`script_for`/`single_for`
  maps, `dispatch`, `acquire_lock`, `escalate`, `classify_failure`, and the
  `poll_adr` external-state-watch shape; `scripts/_common.sh`'s `as_human`,
  `require_claude_auth`, `render`; `prompts/_conventions.md`'s completion-marker
  and rule-B failure protocol; the existing `GET /health` endpoint.
