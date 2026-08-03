-- Align database defaults with the Prisma schema.
--
-- These columns use Prisma's @updatedAt behavior. Their CURRENT_TIMESTAMP
-- defaults were needed by earlier migrations while creating or backfilling
-- non-null columns, but are not part of the current Prisma datamodel.

ALTER TABLE "categories"
    ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "inventory_items"
    ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "staff_members"
    ALTER COLUMN "updated_at" DROP DEFAULT;

ALTER TABLE "stock_categories"
    ALTER COLUMN "updated_at" DROP DEFAULT;
