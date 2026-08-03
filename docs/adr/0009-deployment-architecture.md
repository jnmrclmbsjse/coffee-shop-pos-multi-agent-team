# ADR 0009: Deployment Architecture

- **Status:** Accepted
- **Date:** 2026-08-03
- **Decision owner:** Technical Lead, decided interactively with the operator
- **Context product:** Internal POS + inventory + product/catalog management for a coffee shop

---

## Context

ADR 0001 committed to "AWS, containerized" as the hosting shape but left the
specifics open: "Node API container (ECS/Fargate or EC2), static React SPA on
S3 + CloudFront. Deliberately the most boring, well-trodden AWS deployment
shape available." The app has never been deployed. There is no IaC, no deploy
pipeline, no production configuration.

Two facts specific to this deployment shaped every choice below:

1. **At most 3 people use this app, ever, at a single shop.** Load balancing,
   autoscaling, multi-AZ, and managed high availability all solve problems this
   deployment doesn't have. Optimizing for them would spend money and
   complexity on a non-problem.
2. **This is also a deliberate first-time learning vehicle** for AWS, IaC, and
   automated deployment — for the operator, not just the app. Where a
   trade-off existed between "fastest to ship" and "teaches the underlying AWS
   primitive," this ADR leans toward the latter as long as cost stays low.

The system is also built and operated by an **agentic team** coordinated
through GitHub issues/labels and `scripts/poll.sh` (see `CLAUDE.md`/`AGENTS.md`).
The deploy step needed to fit that same coordination model rather than being a
one-off manual process, per the operator's explicit goal of an autonomous
"story passes QA → goes live" pipeline.

---

## Decision

### Hosting shape: single EC2 instance, not ECS/RDS

One `t4g.small` (Graviton) EC2 instance runs Docker Compose: the API
container, a Postgres container (EBS-backed volume), and nginx. nginx serves
the built SPA as static files at `/` and reverse-proxies `/api/*` to the API
container, so **the SPA and API share one origin** (the CloudFront domain in
front of the box). This is same-origin by construction, not a special case.

Rejected: ECS Fargate + RDS + S3/CloudFront (the shape ADR 0001 gestured at
literally). It is the more "textbook" AWS answer, but a NAT gateway alone
(~$32/mo) plus RDS (~$13/mo) plus Fargate (~$10–15/mo) plus an ALB (~$16/mo)
roughly triples the monthly cost for capacity this app will never need at 3
users, and it introduces cross-origin cookie complexity (`SameSite=None`)
that the single-box shape avoids entirely.

### Edge / TLS / DDoS: CloudFront (default domain) + AWS WAF

CloudFront sits in front of the EC2 origin using its free default
`*.cloudfront.net` certificate — no custom domain is registered yet. An AWS
WAF WebACL (AWS Managed Common Rule Set + a rate-based rule) is attached to
the distribution. The EC2 security group allows inbound `:80` **only** from
the AWS-managed CloudFront prefix list; the origin is unreachable directly.
There is no SSH — the instance is administered only through AWS SSM Session
Manager.

This directly addresses the operator's requirement that an exploit attempt
must not be able to ramp the AWS bill: the WAF rate rule caps abuse at the
edge before it reaches compute, and CloudFront's own DDoS absorption is
included at no extra cost.

### IaC: Pulumi (TypeScript), not Terraform/CDK

The whole codebase and the agentic team's tooling is TypeScript end-to-end.
Pulumi keeps the infrastructure definition in the same language, which
minimizes context-switching for both the human operator (learning AWS for the
first time) and any agent that later touches `infra/`. Terraform is more
industry-ubiquitous and is noted here as the portable alternative if this
project ever needs to hand infrastructure to a team with existing Terraform
conventions.

### Deploy mechanism: agent triggers GitHub Actions via OIDC, not a local push

The autonomous deploy step does not push from any operator's laptop and does
not hold long-lived AWS credentials anywhere. Instead:

- A new `agent:deploy` lane in `scripts/poll.sh` (modeled on the existing
  `poll_adr` lane, which already watches external state — a PR — to resume
  work) watches a **GitHub Actions run** instead.
- On QA acceptance, the story is handed to this lane, which triggers
  `.github/workflows/deploy.yml` via `gh workflow run` and polls it to
  completion.
- The Actions workflow assumes a scoped AWS IAM role via **GitHub OIDC**,
  builds and pushes the API image, builds the SPA, and runs migrations /
  syncs the SPA to the box via **AWS SSM Run Command** (never SSH).
- On a passing health check (`GET /health`), the agent marks the story
  `Deployed`; on failure it escalates using the existing `classify_failure`/
  `escalate` machinery already in `poll.sh` — no new failure-handling
  mechanism was invented.

This was chosen over having the agent deploy directly from local because it
is reproducible, audited (every deploy is a GitHub Actions run with logs), and
does not depend on any specific machine being powered on. The one cost is
building the pipeline itself before the first automated deploy can happen.

**Direct-to-production, no staging environment.** The operator explicitly
accepted this for an internal tool with ≤3 users — the health-check gate plus
a documented sha-based rollback (§ below) is the accepted safety net in place
of a separate staging tier.

### No custom domain (yet)

Shipping on CloudFront's default domain avoids a ~$12/yr registration and any
DNS setup before the app has even gone live once. When a vanity URL becomes
worth having, adding one is a low-effort follow-up, and would also unlock
Cloudflare's free WAF/DDoS tier as an alternative edge layer if the AWS WAF
cost (~$5–10/mo) is ever worth trading away.

---

## Non-Goals (explicit exclusions from this deployment)

- **No load balancing or autoscaling.** Single instance is correct at this
  scale; revisit only if concurrent usage meaningfully grows past a handful
  of people.
- **No managed database (RDS) yet.** Postgres runs in a container on the same
  box; backups are a nightly `pg_dump` to S3, not point-in-time recovery.
- **No multi-AZ / high availability.** One box is a single point of failure,
  accepted for one shop's internal tool.
- **No staging environment.** QA-accepted stories deploy straight to
  production.

---

## Consequences

**Positive**
- Cost stays in the **$15–25/mo** range (less on free tier) — an order of
  magnitude below the ECS/RDS/ALB shape.
- Same-origin SPA+API eliminates CORS and keeps the auth cookie at
  `SameSite=Lax`, the simplest secure posture available.
- No long-lived AWS credentials exist anywhere (OIDC + SSM), and the instance
  has no open SSH port — a materially smaller attack surface than a
  traditionally-administered box.
- The deploy lane reuses 100% of `poll.sh`'s existing dispatch, locking,
  rate-limiting, and escalation machinery — no new orchestration primitive
  was built.
- The single-instance shape doubles as a deliberate, well-scoped AWS learning
  exercise (EC2, IAM, SSM, CloudFront, WAF, OIDC) without paying for capacity
  that would sit idle.

**Negative / accepted trade-offs**
- Single point of failure: if the box goes down, the POS goes down until it's
  restored. Accepted — a coffee shop's manual fallback (pen and paper for a
  short outage) is an acceptable degradation at this scale.
- Backups and OS patching are the operator's responsibility, not AWS-managed.
- `AuthAttemptThrottleService`'s in-memory login-throttle state is correct
  today (exactly one API instance) but would silently weaken if the API were
  ever horizontally scaled without also moving that state to something shared
  (e.g. Redis). Flagged here so a future scale-up doesn't miss it.
- No vanity domain at launch; the CloudFront default URL is functional but
  not brandable.

**Revisit triggers**
- Usage grows meaningfully beyond a handful of concurrent users, or a second
  branch needs its own always-on deployment → revisit RDS + Fargate + ALB (the
  ADR 0001 "textbook" shape) and shared login-throttle state.
- A vanity domain becomes worth the ~$12/yr → add it, and reconsider
  Cloudflare's free WAF/DDoS tier as an edge alternative to AWS WAF.
- Backup/restore burden becomes painful to operate by hand → migrate Postgres
  to RDS for managed backups and patching.

---

## First execution step

Per `infra/DEPLOYMENT.md` (the operational runbook this ADR's decisions are
recorded into), execution proceeds: fix the app-code prerequisites (notably,
the API Dockerfile omits `prisma/` and there is no `migrate deploy` script —
migrations cannot run in the container as it exists today) via the standard
Dev pickup mechanism, then stand up the Pulumi stack, then wire the
`agent:deploy` lane into `poll.sh`.
