import * as pulumi from "@pulumi/pulumi";

const infraConfig = new pulumi.Config("coffee-shop-pos");

export const customDomain = infraConfig.require("customDomain");

// Changing customDomain is a two-phase cutover, because ACM can't validate the
// new certificate until its DNS record exists — and that record's value is
// only known once the certificate has been requested:
//   1. attachCustomDomain: false — request the certificate, serve on the
//      default *.cloudfront.net domain only, read the acmValidation* outputs.
//   2. Add the validation CNAME plus customDomain → CloudFront at the DNS
//      host, then attachCustomDomain: true to validate and attach.
// Skipping phase 1 leaves `pulumi up` blocked on validation past the Infra
// workflow's timeout.
export const attachCustomDomain = infraConfig.getBoolean("attachCustomDomain") ?? true;

// EC2 sizing — see docs/adr/0009-deployment-architecture.md for why a single
// small Graviton instance is deliberately enough for ≤3 users.
export const instanceType = infraConfig.get("instanceType") ?? "t4g.small";

// Pin the production AMI explicitly. Updating this value is an intentional
// instance-replacement operation and must be reviewed separately.
export const amiId = infraConfig.require("amiId");

// "org/repo" that GitHub OIDC is allowed to assume the deploy role from.
export const githubRepo = infraConfig.require("githubRepo");

// Branch allowed to trigger a deploy — direct-to-production per ADR 0009.
export const githubDeployBranch = infraConfig.get("githubDeployBranch") ?? "master";

// GitHub's immutable repository OIDC subject prefix. Newer repositories include
// the immutable owner and repository IDs rather than only the mutable names.
export const githubOidcSubjectPrefix = infraConfig.require("githubOidcSubjectPrefix");

// SSM Parameter Store path prefix this app's secrets live under (see
// infra/DEPLOYMENT.md §3). The instance role and the deploy role are both
// scoped to read/write only under this path — never broader.
export const ssmParamPath = infraConfig.get("ssmParamPath") ?? "/coffee-shop-pos/prod";

// WAF rate-based rule threshold: requests per 5-minute window per IP before
// that IP is blocked. Tune down if abuse is observed (infra/DEPLOYMENT.md §9).
export const wafRateLimitPerFiveMin = infraConfig.getNumber("wafRateLimit") ?? 1000;
