CREATE TYPE "StockLevel" AS ENUM (
    'EMPTY',
    'LOW',
    'QUARTER',
    'ONE_THIRD',
    'HALF',
    'TWO_THIRDS',
    'THREE_QUARTERS',
    'FULL'
);
CREATE TYPE "MovementType" AS ENUM ('DELIVERY', 'WASTAGE');

ALTER TABLE "stock_counts"
    DROP COLUMN "recorded_by",
    ADD COLUMN "submitted_by_staff_member_id" UUID NOT NULL,
    ADD COLUMN "submitted_by_name_snapshot" TEXT NOT NULL,
    ADD COLUMN "shift_lead_staff_member_id" UUID,
    ADD COLUMN "shift_lead_name_snapshot" TEXT;

ALTER TABLE "stock_count_lines"
    ALTER COLUMN "quantity" DROP NOT NULL,
    ADD COLUMN "level" "StockLevel",
    ADD CONSTRAINT "stock_count_lines_value_check" CHECK (
        (
            ("quantity" IS NOT NULL AND "level" IS NULL)
            OR ("quantity" IS NULL AND "level" IS NOT NULL)
        )
        AND ("quantity" IS NULL OR "quantity" >= 0)
    );

CREATE TABLE "stock_movements" (
    "id" UUID NOT NULL,
    "location_id" UUID,
    "business_date" DATE NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "type" "MovementType" NOT NULL,
    "quantity" INTEGER NOT NULL,
    "recorded_by_staff_member_id" UUID,
    "recorded_by_name_snapshot" TEXT,
    "reason" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_movements_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "stock_movements_quantity_non_negative_check"
        CHECK ("quantity" >= 0)
);

CREATE INDEX "stock_movements_location_id_business_date_recorded_at_idx"
    ON "stock_movements"("location_id", "business_date", "recorded_at");

ALTER TABLE "trading_days"
    ADD COLUMN "day_type" "DayType" NOT NULL DEFAULT 'NORMAL';

ALTER TABLE "stock_counts"
    ADD CONSTRAINT "stock_counts_submitted_by_staff_member_id_fkey"
    FOREIGN KEY ("submitted_by_staff_member_id") REFERENCES "staff_members"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "stock_counts_shift_lead_staff_member_id_fkey"
    FOREIGN KEY ("shift_lead_staff_member_id") REFERENCES "staff_members"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "stock_movements"
    ADD CONSTRAINT "stock_movements_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "stock_movements_inventory_item_id_fkey"
    FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "stock_movements_recorded_by_staff_member_id_fkey"
    FOREIGN KEY ("recorded_by_staff_member_id") REFERENCES "staff_members"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
