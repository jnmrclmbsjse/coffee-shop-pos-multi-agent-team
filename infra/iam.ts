import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { ssmParamPath } from "./config";

// EC2 instance role. SSM managed policy gives us Session Manager shell access
// with no SSH port open at all (docs/adr/0009-deployment-architecture.md).
export const instanceRole = new aws.iam.Role("ec2-instance-role", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "ec2.amazonaws.com",
  }),
  tags: { Project: "coffee-shop-pos" },
});

new aws.iam.RolePolicyAttachment("ec2-ssm-core", {
  role: instanceRole.name,
  policyArn: "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore",
});

// Buckets are created in storage.ts; declared here as pulumi.Output params so
// this module doesn't need to import storage.ts and create a require cycle —
// instead index.ts wires the bucket ARNs in after both modules are built.
export function attachAppPolicy(
  roleName: pulumi.Input<string>,
  spaBucketArn: pulumi.Input<string>,
  backupsBucketArn: pulumi.Input<string>,
  apiRepositoryArn: pulumi.Input<string>,
) {
  return new aws.iam.RolePolicy("ec2-app-policy", {
    role: roleName,
    policy: pulumi
      .all([spaBucketArn, backupsBucketArn, apiRepositoryArn])
      .apply(([spaArn, backupsArn, repositoryArn]) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Sid: "ReadOwnSecrets",
            Effect: "Allow",
            Action: ["ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath"],
            Resource: `arn:aws:ssm:*:*:parameter${ssmParamPath}/*`,
          },
          {
            Sid: "AuthenticateToEcr",
            Effect: "Allow",
            Action: ["ecr:GetAuthorizationToken"],
            Resource: "*",
          },
          {
            Sid: "PullApiImage",
            Effect: "Allow",
            Action: [
              "ecr:BatchCheckLayerAvailability",
              "ecr:BatchGetImage",
              "ecr:GetDownloadUrlForLayer",
            ],
            Resource: repositoryArn,
          },
          {
            Sid: "ReadSpaBuild",
            Effect: "Allow",
            Action: ["s3:GetObject", "s3:ListBucket"],
            Resource: [spaArn, `${spaArn}/*`],
          },
          {
            Sid: "WriteNightlyBackups",
            Effect: "Allow",
            Action: ["s3:PutObject", "s3:ListBucket"],
            Resource: [backupsArn, `${backupsArn}/*`],
          },
        ],
      }),
    ),
  });
}

export const instanceProfile = new aws.iam.InstanceProfile("ec2-instance-profile", {
  role: instanceRole.name,
});
