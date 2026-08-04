import * as aws from "@pulumi/aws";
import { customDomain, wafRateLimitPerFiveMin } from "./config";
import { originDomainName } from "./compute";
import { infraRolePolicy } from "./oidc";

// WAF WebACLs scoped to CLOUDFRONT must be created in us-east-1 regardless of
// which region everything else lives in — a CloudFront-specific AWS quirk.
const usEast1 = new aws.Provider("us-east-1", { region: "us-east-1" });

export const appCertificate = new aws.acm.Certificate(
  "app-certificate-v2",
  {
    domainName: customDomain,
    validationMethod: "DNS",
    tags: { Project: "coffee-shop-pos" },
  },
  {
    provider: usEast1,
    dependsOn: [infraRolePolicy],
  },
);

const certificateValidationOption =
  appCertificate.domainValidationOptions.apply((options) => {
    const option = options.find(({ domainName }) => domainName === customDomain);

    if (!option) {
      throw new Error(
        `ACM did not return a DNS validation option for ${customDomain}`,
      );
    }

    return option;
  });

export const certificateValidationRecordName =
  certificateValidationOption.apply(({ resourceRecordName }) => resourceRecordName);

export const certificateValidationRecordType =
  certificateValidationOption.apply(({ resourceRecordType }) => resourceRecordType);

export const certificateValidationRecordValue =
  certificateValidationOption.apply(({ resourceRecordValue }) => resourceRecordValue);

export const webAcl = new aws.wafv2.WebAcl(
  "cloudfront-waf",
  {
    scope: "CLOUDFRONT",
    defaultAction: { allow: {} },
    visibilityConfig: {
      cloudwatchMetricsEnabled: true,
      metricName: "coffee-shop-pos-waf",
      sampledRequestsEnabled: true,
    },
    rules: [
      {
        name: "aws-managed-common",
        priority: 0,
        overrideAction: { none: {} },
        statement: {
          managedRuleGroupStatement: {
            vendorName: "AWS",
            name: "AWSManagedRulesCommonRuleSet",
          },
        },
        visibilityConfig: {
          cloudwatchMetricsEnabled: true,
          metricName: "aws-managed-common",
          sampledRequestsEnabled: true,
        },
      },
      {
        // Primary defense against an exploit/crawler ramping up the AWS bill
        // (docs/adr/0009-deployment-architecture.md) — blocks any single IP
        // exceeding the threshold in a rolling 5-minute window.
        name: "rate-limit-per-ip",
        priority: 1,
        action: { block: {} },
        statement: {
          rateBasedStatement: {
            limit: wafRateLimitPerFiveMin,
            aggregateKeyType: "IP",
          },
        },
        visibilityConfig: {
          cloudwatchMetricsEnabled: true,
          metricName: "rate-limit-per-ip",
          sampledRequestsEnabled: true,
        },
      },
    ],
  },
  { provider: usEast1 },
);

// The AWS provider types these managed-policy lookups' `.id` as possibly
// undefined (the field is generically optional on the data source), but a
// well-known AWS-managed policy name always resolves — assert non-null here
// rather than threading an unreachable "policy not found" case through.
const cachingOptimizedId = aws.cloudfront
  .getCachePolicyOutput({ name: "Managed-CachingOptimized" })
  .id!.apply((id) => id!);
const cachingDisabledId = aws.cloudfront
  .getCachePolicyOutput({ name: "Managed-CachingDisabled" })
  .id!.apply((id) => id!);
const allViewerId = aws.cloudfront
  .getOriginRequestPolicyOutput({ name: "Managed-AllViewer" })
  .id!.apply((id) => id!);

const originId = "coffee-shop-pos-origin";

export const distribution = new aws.cloudfront.Distribution("app-distribution", {
  enabled: true,
  webAclId: webAcl.arn,
  defaultRootObject: "index.html",
  origins: [
    {
      originId,
      domainName: originDomainName,
      // Origin is plain HTTP — TLS is terminated at CloudFront's edge, which
      // is the standard pattern for a single-box origin with no ACM cert of
      // its own (docs/adr/0009-deployment-architecture.md).
      customOriginConfig: {
        httpPort: 80,
        httpsPort: 443,
        originProtocolPolicy: "http-only",
        originSslProtocols: ["TLSv1.2"],
      },
    },
  ],
  defaultCacheBehavior: {
    targetOriginId: originId,
    viewerProtocolPolicy: "redirect-to-https",
    allowedMethods: ["GET", "HEAD"],
    cachedMethods: ["GET", "HEAD"],
    cachePolicyId: cachingOptimizedId,
    compress: true,
  },
  orderedCacheBehaviors: [
    {
      // API traffic always bypasses the cache and forwards cookies/methods —
      // this is same-origin, so the SPA's fetches to /api/* ride this behavior.
      pathPattern: "/api/*",
      targetOriginId: originId,
      viewerProtocolPolicy: "redirect-to-https",
      allowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
      cachedMethods: ["GET", "HEAD"],
      cachePolicyId: cachingDisabledId,
      originRequestPolicyId: allViewerId,
    },
  ],
  restrictions: { geoRestriction: { restrictionType: "none" } },
  viewerCertificate: { cloudfrontDefaultCertificate: true },
  tags: { Project: "coffee-shop-pos" },
});

export const distributionDomainName = distribution.domainName;
