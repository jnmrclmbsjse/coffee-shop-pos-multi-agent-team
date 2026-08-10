import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as tls from "@pulumi/tls";
import { githubDeployBranch, githubOidcSubjectPrefix, ssmParamPath } from "./config";
import { instanceId } from "./compute";
import { spaBucket } from "./storage";
import { apiRepository } from "./registry";

// GitHub's OIDC token issuer thumbprint, fetched live from the actual TLS
// certificate chain at apply time — the same value AWS's docs describe
// computing manually via `openssl`, just done as code. Deliberately NOT
// hardcoded: a hand-typed SHA-1 thumbprint is exactly the kind of value that's
// easy to mis-transcribe (must be precisely 40 hex chars) and silently wrong
// if it ever is, since it's a security trust anchor. This also self-updates
// if GitHub ever rotates the certificate.
const githubOidcCert = tls.getCertificateOutput({ url: "https://token.actions.githubusercontent.com" });
const githubOidcThumbprint = githubOidcCert.certificates.apply(
  (certs) => certs[certs.length - 1].sha1Fingerprint,
);

export const githubOidcProvider = new aws.iam.OpenIdConnectProvider("github-actions", {
  url: "https://token.actions.githubusercontent.com",
  clientIdLists: ["sts.amazonaws.com"],
  thumbprintLists: [githubOidcThumbprint],
});

// Scoped to exactly this repo + branch — no other repo or branch can assume
// this role, and it holds no long-lived AWS keys (docs/adr/0009).
export const deployRole = new aws.iam.Role("github-deploy-role", {
  assumeRolePolicy: pulumi.all([githubOidcProvider.arn]).apply(([providerArn]) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Federated: providerArn },
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: {
            StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
            StringLike: {
              "token.actions.githubusercontent.com:sub": `${githubOidcSubjectPrefix}:ref:refs/heads/${githubDeployBranch}`,
            },
          },
        },
      ],
    }),
  ),
  tags: { Project: "coffee-shop-pos" },
});

new aws.iam.RolePolicy("github-deploy-policy", {
  role: deployRole.id,
  policy: pulumi
    .all([spaBucket.arn, instanceId, apiRepository.arn])
    .apply(([spaArn, instId, repositoryArn]) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "ListDeploymentBucketPrefixes",
          Effect: "Allow",
          Action: ["s3:ListBucket"],
          Resource: spaArn,
          Condition: {
            StringLike: {
              "s3:prefix": [
                "spa",
                "spa/",
                "spa/*",
                "deploy-config",
                "deploy-config/",
                "deploy-config/*",
              ],
            },
          },
        },
        {
          Sid: "UploadSpaAndDeployConfig",
          Effect: "Allow",
          Action: ["s3:PutObject"],
          Resource: [
            `${spaArn}/spa/*`,
            `${spaArn}/deploy-config/*`,
          ],
        },
        {
          Sid: "DeleteStaleSpaObjects",
          Effect: "Allow",
          Action: ["s3:DeleteObject"],
          Resource: `${spaArn}/spa/*`,
        },
        {
          Sid: "AuthenticateToEcr",
          Effect: "Allow",
          Action: ["ecr:GetAuthorizationToken"],
          Resource: "*",
        },
        {
          Sid: "PushApiImage",
          Effect: "Allow",
          Action: [
            "ecr:BatchCheckLayerAvailability",
            "ecr:BatchGetImage",
            "ecr:CompleteLayerUpload",
            "ecr:DescribeImages",
            "ecr:InitiateLayerUpload",
            "ecr:PutImage",
            "ecr:UploadLayerPart",
          ],
          Resource: repositoryArn,
        },
        {
          Sid: "RunDeployCommand",
          Effect: "Allow",
          Action: ["ssm:SendCommand"],
          Resource: [
            `arn:aws:ec2:*:*:instance/${instId}`,
            "arn:aws:ssm:*:*:document/AWS-RunShellScript",
          ],
        },
        {
          Sid: "ReadDeployCommandResult",
          Effect: "Allow",
          Action: ["ssm:GetCommandInvocation", "ssm:ListCommandInvocations"],
          Resource: "*",
        },
        {
          Sid: "ReadOwnSecretsForPreflight",
          Effect: "Allow",
          Action: ["ssm:GetParameter", "ssm:GetParameters"],
          Resource: `arn:aws:ssm:*:*:parameter${ssmParamPath}/*`,
        },
      ],
    }),
  ),
});

export const deployRoleArn = deployRole.arn;
export const deployRoleId = deployRole.id;

// ---------------------------------------------------------------------------
// Infra-apply role — lets .github/workflows/infra.yml run `pulumi preview`/
// `up` in CI for every change AFTER the one-time bootstrap apply (which must
// run from AWS CloudShell, since it's what CREATES this very OIDC provider —
// see infra/DEPLOYMENT.md §5a). Deliberately a SEPARATE, broader role from
// deployRole above: deployRole only ever needs to upload a build and run one
// SSM command; this role needs to create/modify EC2, IAM, S3, CloudFront, and
// WAF resources, because that's what standing up or changing this stack means.
//
// Accepted trade-off: this role can create IAM roles/policies (including,
// in principle, one it could use to escalate) — a real privilege-escalation
// smell in a shared enterprise account. Accepted here because this is a
// solo-operator repo already gated by GitHub's own branch protection and repo
// access controls, not a multi-tenant AWS account. Revisit with tighter
// resource-level IAM scoping if this ever stops being true.
export const infraRole = new aws.iam.Role("github-infra-role", {
  assumeRolePolicy: pulumi.all([githubOidcProvider.arn]).apply(([providerArn]) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Federated: providerArn },
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: {
            StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
            StringLike: {
              "token.actions.githubusercontent.com:sub": `${githubOidcSubjectPrefix}:ref:refs/heads/${githubDeployBranch}`,
            },
          },
        },
      ],
    }),
  ),
  tags: { Project: "coffee-shop-pos" },
});

export const infraRolePolicy = new aws.iam.RolePolicy("github-infra-policy", {
  role: infraRole.id,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "ManageStackResources",
        Effect: "Allow",
        Action: [
          "ec2:*",
          "s3:*",
          "ecr:*",
          "cloudfront:*",
          "wafv2:*",
          "acm:*",
          "iam:*Role*",
          "iam:*InstanceProfile*",
          "iam:CreateOpenIDConnectProvider",
          "iam:GetOpenIDConnectProvider",
          "iam:DeleteOpenIDConnectProvider",
          "iam:TagOpenIDConnectProvider",
          "iam:ListOpenIDConnectProviders",
          "iam:UpdateOpenIDConnectProviderThumbprint",
          "iam:PassRole",
        ],
        Resource: "*",
      },
      {
        Sid: "ReadAmazonLinuxArm64AmiParameter",
        Effect: "Allow",
        Action: "ssm:GetParameter",
        Resource:
          "arn:aws:ssm:*::parameter/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64",
      },
    ],
  }),
});

export const infraRoleArn = infraRole.arn;
