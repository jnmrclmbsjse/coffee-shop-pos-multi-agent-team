import { attachAppPolicy, instanceRole } from "./iam";
import { spaBucket, backupsBucket } from "./storage";
import { apiRepository } from "./registry";
import { instanceId } from "./compute";
import { distributionDomainName, webAcl } from "./edge";
import { deployRoleArn, githubOidcProvider, infraRoleArn } from "./oidc";

attachAppPolicy(
  instanceRole.name,
  spaBucket.arn,
  backupsBucket.arn,
  apiRepository.arn,
);

export const siteUrl = distributionDomainName.apply((d) => `https://${d}`);
export const ec2InstanceId = instanceId;
export const spaBucketName = spaBucket.id;
export const backupsBucketName = backupsBucket.id;
export const apiRepositoryUrl = apiRepository.repositoryUrl;
export const githubDeployRoleArn = deployRoleArn;
export const githubInfraRoleArn = infraRoleArn;
export const wafWebAclArn = webAcl.arn;
export const githubOidcProviderArn = githubOidcProvider.arn;
