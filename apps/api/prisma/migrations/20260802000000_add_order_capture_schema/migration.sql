ALTER TYPE "LineDiscountKind" ADD VALUE 'PWD' BEFORE 'SENIOR';

CREATE TYPE "LinePreference" AS ENUM (
    'SWEETER',
    'STRONGER',
    'LESS_SWEET',
    'LESS_ICE'
);

ALTER TABLE "categories"
    ADD COLUMN "free_upsize_eligible" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "sales"
    ADD COLUMN "free_upsize_cents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "sale_lines"
    ADD COLUMN "preferences" "LinePreference"[] NOT NULL DEFAULT ARRAY[]::"LinePreference"[],
    ADD COLUMN "preference_note" TEXT,
    ADD COLUMN "free_upsize_count" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "free_upsize_cents" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "free_upsize_eligible" BOOLEAN;

-- Existing lines predate the promotion and therefore were never eligible at
-- capture time. Keep the new snapshot required without inventing eligibility.
UPDATE "sale_lines"
SET "free_upsize_eligible" = false;

ALTER TABLE "sale_lines"
    ALTER COLUMN "free_upsize_eligible" SET NOT NULL;
