import * as aws from "@pulumi/aws";
import { instanceType } from "./config";
import { instanceProfile } from "./iam";
import { originSecurityGroup, subnetId } from "./network";

// Amazon Linux 2023, arm64 (Graviton) — resolved via AWS's public SSM
// parameter rather than a hardcoded AMI ID, so it always picks up the latest
// patched image for the region without us tracking AMI IDs by hand.
const al2023Arm64Ami = aws.ssm.getParameterOutput({
  name: "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-arm64",
});

// Installs Docker + the Compose plugin + AWS CLI. Does NOT deploy the app —
// docker-compose.yml, nginx config, and the actual containers are pushed by
// the GitHub Actions deploy pipeline via SSM Run Command on first deploy
// (infra/DEPLOYMENT.md §6–§7). This keeps the AMI/user-data boring and the
// deploy pipeline the single source of truth for what's running.
const userData = `#!/bin/bash
set -euxo pipefail
dnf install -y docker unzip
systemctl enable --now docker
usermod -aG docker ec2-user

curl -Lo /tmp/awscliv2.zip "https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip"
unzip -q /tmp/awscliv2.zip -d /tmp
/tmp/aws/install

mkdir -p /usr/local/lib/docker/cli-plugins
curl -Lo /usr/local/lib/docker/cli-plugins/docker-compose \\
  "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-aarch64"
chmod +x /usr/local/lib/docker/cli-plugins/docker-compose

mkdir -p /opt/coffee-shop-pos /var/www/spa
`;

export const appInstance = new aws.ec2.Instance("app-instance", {
  instanceType,
  ami: al2023Arm64Ami.value,
  subnetId,
  vpcSecurityGroupIds: [originSecurityGroup.id],
  iamInstanceProfile: instanceProfile.name,
  userData,
  rootBlockDevice: { volumeSize: 20, volumeType: "gp3" },
  tags: { Project: "coffee-shop-pos", Name: "coffee-shop-pos-app" },
});

// A stable public IP so the CloudFront origin domain never has to change —
// without this, stopping/starting the instance would issue a new IP each time.
export const appEip = new aws.ec2.Eip("app-eip", {
  instance: appInstance.id,
  domain: "vpc",
  tags: { Project: "coffee-shop-pos" },
});

export const instanceId = appInstance.id;
export const originDomainName = appEip.publicDns;
