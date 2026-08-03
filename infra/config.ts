import * as pulumi from "@pulumi/pulumi";

const infraConfig = new pulumi.Config("coffee-shop-pos");

// EC2 sizing — see docs/adr/0009-deployment-architecture.md for why a single
// small Graviton instance is deliberately enough for ≤3 users.
export const instanceType = infraConfig.get("instanceType") ?? "t4g.small";

// "org/repo" that GitHub OIDC is allowed to assume the deploy role from.
export const githubRepo = infraConfig.require("githubRepo");

// Branch allowed to trigger a deploy — direct-to-production per ADR 0009.
export const githubDeployBranch = infraConfig.get("githubDeployBranch") ?? "master";

// SSM Parameter Store path prefix this app's secrets live under (see
// infra/DEPLOYMENT.md §3). The instance role and the deploy role are both
// scoped to read/write only under this path — never broader.
export const ssmParamPath = infraConfig.get("ssmParamPath") ?? "/coffee-shop-pos/prod";

// WAF rate-based rule threshold: requests per 5-minute window per IP before
// that IP is blocked. Tune down if abuse is observed (infra/DEPLOYMENT.md §9).
export const wafRateLimitPerFiveMin = infraConfig.getNumber("wafRateLimit") ?? 1000;
