CREATE TYPE "OrderStatus" AS ENUM ('PARKED', 'COMPLETED');
CREATE TYPE "ServiceType" AS ENUM ('DINE_IN', 'TAKE_OUT');
CREATE TYPE "LineDiscountKind" AS ENUM ('NONE', 'SENIOR');

ALTER TABLE "sales"
    ADD COLUMN "day_order_number" INTEGER,
    ADD COLUMN "status" "OrderStatus",
    ADD COLUMN "customer_name" TEXT,
    ADD COLUMN "service_type" "ServiceType",
    ADD COLUMN "discount_cents" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "cash_received_cents" INTEGER,
    ADD COLUMN "change_owed_cents" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "change_settled_at" TIMESTAMP(3),
    ADD COLUMN "completed_at" TIMESTAMP(3),
    ADD COLUMN "void_reason" TEXT;

-- Existing rows receive a stable order number within their trading day. The
-- UUID tie-breaker makes rows with identical write timestamps deterministic.
WITH numbered_sales AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (
            PARTITION BY "trading_day_id"
            ORDER BY "recorded_at", "id"
        )::INTEGER AS "day_order_number"
    FROM "sales"
)
UPDATE "sales"
SET "day_order_number" = numbered_sales."day_order_number",
    "status" = 'COMPLETED',
    "service_type" = 'TAKE_OUT'
FROM numbered_sales
WHERE "sales"."id" = numbered_sales."id";

ALTER TABLE "sales"
    ALTER COLUMN "day_order_number" SET NOT NULL,
    ALTER COLUMN "status" SET NOT NULL,
    ALTER COLUMN "service_type" SET NOT NULL;

CREATE UNIQUE INDEX "sales_trading_day_id_day_order_number_key"
    ON "sales"("trading_day_id", "day_order_number");

ALTER TABLE "sale_lines"
    ADD COLUMN "line_gross_cents" INTEGER,
    ADD COLUMN "discount_kind" "LineDiscountKind",
    ADD COLUMN "discount_cents" INTEGER NOT NULL DEFAULT 0;

-- No discounted rows exist before this migration, so the former line total is
-- exactly the pre-discount gross. No historical money value is recomputed.
UPDATE "sale_lines"
SET "line_gross_cents" = "line_total_cents",
    "discount_kind" = 'NONE';

ALTER TABLE "sale_lines"
    ALTER COLUMN "line_gross_cents" SET NOT NULL,
    ALTER COLUMN "discount_kind" SET NOT NULL;
