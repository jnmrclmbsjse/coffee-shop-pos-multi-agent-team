import * as aws from "@pulumi/aws";
import { attachAppPolicy, instanceRole } from "./iam";
import { spaBucket, backupsBucket } from "./storage";
import { apiRepository } from "./registry";
import { instanceId } from "./compute";
import {
  appCertificate,
  certificateValidationRecordName,
  certificateValidationRecordType,
  certificateValidationRecordValue,
  distributionArn,
  distributionDomainName,
  distributionId,
  webAcl,
} from "./edge";
import { deployRoleArn, deployRoleId, githubOidcProvider, infraRoleArn } from "./oidc";

attachAppPolicy(
  instanceRole.name,
  spaBucket.arn,
  backupsBucket.arn,
  apiRepository.arn,
);

// Wired here (not in oidc.ts) to avoid a circular import — oidc.ts already
// backs edge.ts's ACM cert dependency, so edge.ts can't import oidc.ts's
// deploy role back. Lets the deploy pipeline invalidate the SPA's cached
// index.html after every S3 sync (see deploy.yml's "Invalidate CloudFront
// cache" step) instead of waiting out CachingOptimized's default 24h TTL.
new aws.iam.RolePolicy("github-deploy-cloudfront-policy", {
  role: deployRoleId,
  policy: distributionArn.apply((arn) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "InvalidateSpaCache",
          Effect: "Allow",
          Action: ["cloudfront:CreateInvalidation"],
          Resource: arn,
        },
      ],
    }),
  ),
});

export const siteUrl = distributionDomainName.apply((d) => `https://${d}`);
export const cloudfrontDistributionId = distributionId;
export const acmCertificateArn = appCertificate.arn;
export const acmValidationRecordName = certificateValidationRecordName;
export const acmValidationRecordType = certificateValidationRecordType;
export const acmValidationRecordValue = certificateValidationRecordValue;
export const ec2InstanceId = instanceId;
export const spaBucketName = spaBucket.id;
export const backupsBucketName = backupsBucket.id;
export const apiRepositoryUrl = apiRepository.repositoryUrl;
export const githubDeployRoleArn = deployRoleArn;
export const githubInfraRoleArn = infraRoleArn;
export const wafWebAclArn = webAcl.arn;
export const githubOidcProviderArn = githubOidcProvider.arn;
