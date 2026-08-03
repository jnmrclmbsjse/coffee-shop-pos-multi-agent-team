# infra/ — Pulumi (TypeScript)

Provisions the AWS resources described in
[`docs/adr/0009-deployment-architecture.md`](../docs/adr/0009-deployment-architecture.md):
one EC2 instance (API + Postgres + nginx via Docker Compose), CloudFront +
WAF in front of it, S3 for SPA builds + DB backups, and a GitHub OIDC role for
the deploy pipeline. Full runbook: [`DEPLOYMENT.md`](./DEPLOYMENT.md).

## No standing local install needed

Nothing here is installed directly on the host, and it doesn't need to be.
After a one-time bootstrap, every infra change (`pulumi preview`/`up`) runs in
**GitHub Actions** (`.github/workflows/infra.yml`), authenticated via OIDC —
no AWS keys anywhere, no Pulumi/AWS CLI on any laptop.

## Bring-up (one-time bootstrap — see `DEPLOYMENT.md` §5a for the full why)

The very first apply can't yet use GitHub Actions, because it's what *creates*
the OIDC provider that role assumption depends on. That one run happens in a
**throwaway local Docker container** (`Dockerfile.bootstrap`) — not installed
on the host, gone the moment the container exits:

```sh
cd infra
docker build -f Dockerfile.bootstrap -t coffee-shop-pos-bootstrap .
docker run -it --rm \
  -v "$(pwd):/workspace" \
  -e AWS_ACCESS_KEY_ID=<bootstrap-admin access key — deleted after, see DEPLOYMENT.md §5a> \
  -e AWS_SECRET_ACCESS_KEY=<...> \
  -e AWS_DEFAULT_REGION=ap-southeast-1 \
  -e PULUMI_ACCESS_TOKEN=<Pulumi Cloud token> \
  coffee-shop-pos-bootstrap bash
# inside the container:
aws sts get-caller-identity
pulumi login
npm ci
pulumi stack init prod
pulumi up
```

`Pulumi.prod.yaml` already has the non-secret config values filled in
(region, GitHub repo, instance size, WAF threshold). Nothing in this repo's
`infra/` directory contains a secret — application secrets (`JWT_SECRET`, DB
password, seed credentials) are created directly in SSM Parameter Store per
`DEPLOYMENT.md` §3, not through Pulumi config.

After this one run, set the GitHub Actions repo variables/secret it unlocks,
delete the bootstrap IAM access key (see `DEPLOYMENT.md` §5a step G), and use
`.github/workflows/infra.yml` for every change from then on.

## Outputs

`pulumi stack output` after `up` gives you:

- `siteUrl` — the CloudFront URL the app will be live at
- `ec2InstanceId` — target for SSM Run Command / Session Manager
- `spaBucketName`, `backupsBucketName`
- `apiRepositoryUrl` — private ECR repository URL used by `deploy.yml`
- `githubDeployRoleArn` — used by `deploy.yml` (app deploys)
- `githubInfraRoleArn` — used by `infra.yml` (infra changes, from now on)
- `wafWebAclArn`

## Notes

- The WAF WebACL is created via a `us-east-1`-pinned provider alias
  (`edge.ts`) regardless of `aws:region`, because CloudFront-scoped WAF
  WebACLs are a us-east-1-only resource in AWS.
- The GitHub OIDC thumbprint in `oidc.ts` is the standard published value for
  `token.actions.githubusercontent.com` — reconfirm it's still current before
  first apply (AWS's docs are the source of truth).
- No SSH: administration is via AWS SSM Session Manager only.
