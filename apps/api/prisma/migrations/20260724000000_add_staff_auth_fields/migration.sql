ALTER TABLE "users"
ADD COLUMN "display_name" TEXT,
ADD COLUMN "pin_hash" TEXT,
ADD COLUMN "is_active" BOOLEAN NOT NULL DEFAULT true;

UPDATE "users"
SET "display_name" = "username"
WHERE "display_name" IS NULL;

ALTER TABLE "users"
ALTER COLUMN "display_name" SET NOT NULL;
