import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

// Deliberately the default VPC — no custom networking, no NAT gateway. See
// docs/adr/0009-deployment-architecture.md: this app never needs a private
// subnet, and a NAT gateway alone would roughly match the EC2 instance's cost.
const defaultVpc = aws.ec2.getVpcOutput({ default: true });
const defaultSubnets = defaultVpc.id.apply((vpcId) =>
  aws.ec2.getSubnets({ filters: [{ name: "vpc-id", values: [vpcId] }] }),
);

export const vpcId = defaultVpc.id;
export const subnetId = defaultSubnets.apply((s) => s.ids[0]);

// AWS-managed prefix list of CloudFront's edge IP ranges. Locking the
// security group to this — instead of 0.0.0.0/0 — means the EC2 origin is
// unreachable except through CloudFront (and therefore through the WAF).
const cloudfrontPrefixList = aws.ec2.getManagedPrefixListOutput({
  name: "com.amazonaws.global.cloudfront.origin-facing",
});

export const originSecurityGroup = new aws.ec2.SecurityGroup("origin-sg", {
  vpcId,
  description: "Coffee Shop POS origin - HTTP from CloudFront only, no SSH",
  ingress: [
    {
      description: "HTTP from CloudFront edge locations only",
      protocol: "tcp",
      fromPort: 80,
      toPort: 80,
      prefixListIds: [cloudfrontPrefixList.id],
    },
  ],
  egress: [
    {
      description: "Outbound for package installs, SSM, ECR/GHCR pulls, S3",
      protocol: "-1",
      fromPort: 0,
      toPort: 0,
      cidrBlocks: ["0.0.0.0/0"],
    },
  ],
  tags: { Project: "coffee-shop-pos" },
});
