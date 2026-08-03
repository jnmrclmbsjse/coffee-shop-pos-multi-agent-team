import * as aws from "@pulumi/aws";

// Private API image registry.
//
// Images are tagged with the immutable Git commit SHA by the deployment
// workflow. Scan-on-push provides an initial vulnerability assessment without
// introducing a separate scanning service into the deployment pipeline.
export const apiRepository = new aws.ecr.Repository("api-repository", {
  name: "coffee-shop-pos-api",
  imageTagMutability: "IMMUTABLE",
  imageScanningConfiguration: {
    scanOnPush: true,
  },
  tags: {
    Project: "coffee-shop-pos",
  },
});
