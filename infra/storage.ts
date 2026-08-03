import * as aws from "@pulumi/aws";

// Holds each SPA build (synced to the box on every deploy) and lets a
// rollback fall back to a previous version via bucket versioning.
export const spaBucket = new aws.s3.BucketV2("spa-build", {
  tags: { Project: "coffee-shop-pos" },
});

new aws.s3.BucketVersioningV2("spa-build-versioning", {
  bucket: spaBucket.id,
  versioningConfiguration: { status: "Enabled" },
});

new aws.s3.BucketPublicAccessBlock("spa-build-block-public", {
  bucket: spaBucket.id,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});

// Nightly pg_dump destination (infra/DEPLOYMENT.md §4/§8).
export const backupsBucket = new aws.s3.BucketV2("db-backups", {
  tags: { Project: "coffee-shop-pos" },
});

new aws.s3.BucketLifecycleConfigurationV2("db-backups-lifecycle", {
  bucket: backupsBucket.id,
  rules: [
    {
      id: "expire-old-backups",
      status: "Enabled",
      expiration: { days: 30 },
    },
  ],
});

new aws.s3.BucketPublicAccessBlock("db-backups-block-public", {
  bucket: backupsBucket.id,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});
