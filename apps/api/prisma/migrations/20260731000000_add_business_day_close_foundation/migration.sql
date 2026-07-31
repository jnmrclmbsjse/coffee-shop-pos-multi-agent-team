BEGIN;

CREATE TYPE "CashMovementKind" AS ENUM ('CASH_IN', 'CASH_OUT', 'EXPENSE');

CREATE TABLE "cash_movements" (
    "id" UUID NOT NULL,
    "trading_day_id" UUID NOT NULL,
    "kind" "CashMovementKind" NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "recorded_by_staff_member_id" UUID,
    "recorded_by_name_snapshot" TEXT,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_movements_trading_day_id_recorded_at_idx"
    ON "cash_movements"("trading_day_id", "recorded_at");

ALTER TABLE "cash_movements"
    ADD CONSTRAINT "cash_movements_trading_day_id_fkey"
    FOREIGN KEY ("trading_day_id") REFERENCES "trading_days"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "cash_movements_recorded_by_staff_member_id_fkey"
    FOREIGN KEY ("recorded_by_staff_member_id") REFERENCES "staff_members"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO "cash_movements" (
    "id",
    "trading_day_id",
    "kind",
    "amount_cents",
    "description",
    "recorded_at"
)
SELECT
    "id",
    "trading_day_id",
    'EXPENSE'::"CashMovementKind",
    "amount_cents",
    "description",
    "recorded_at"
FROM "cash_expenses";

DROP TABLE "cash_expenses";

CREATE TABLE "day_closings" (
    "id" UUID NOT NULL,
    "trading_day_id" UUID NOT NULL,
    "cash_count_id" UUID NOT NULL,
    "opening_float_cents" INTEGER NOT NULL,
    "cash_sales_cents" INTEGER NOT NULL,
    "online_sales_cents" INTEGER NOT NULL,
    "cash_tips_cents" INTEGER NOT NULL,
    "cash_in_cents" INTEGER NOT NULL,
    "cash_out_cents" INTEGER NOT NULL,
    "cash_expenses_cents" INTEGER NOT NULL,
    "outstanding_change_cents" INTEGER NOT NULL,
    "expected_cash_cents" INTEGER NOT NULL,
    "actual_cash_cents" INTEGER NOT NULL,
    "variance_cents" INTEGER NOT NULL,
    "variance_reason" TEXT,
    "closed_by_staff_member_id" UUID NOT NULL,
    "closed_by_name_snapshot" TEXT NOT NULL,
    "closed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "day_closings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "day_closings_trading_day_id_key"
    ON "day_closings"("trading_day_id");
CREATE UNIQUE INDEX "day_closings_cash_count_id_key"
    ON "day_closings"("cash_count_id");

CREATE TABLE "day_closing_lines" (
    "id" UUID NOT NULL,
    "day_closing_id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "item_name_snapshot" TEXT NOT NULL,
    "expected_qty" INTEGER,
    "actual_qty" INTEGER,
    "variance_qty" INTEGER,

    CONSTRAINT "day_closing_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "day_closing_lines_day_closing_id_inventory_item_id_key"
    ON "day_closing_lines"("day_closing_id", "inventory_item_id");

ALTER TABLE "day_closings"
    ADD CONSTRAINT "day_closings_trading_day_id_fkey"
    FOREIGN KEY ("trading_day_id") REFERENCES "trading_days"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "day_closings_cash_count_id_fkey"
    FOREIGN KEY ("cash_count_id") REFERENCES "cash_counts"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "day_closings_closed_by_staff_member_id_fkey"
    FOREIGN KEY ("closed_by_staff_member_id") REFERENCES "staff_members"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "day_closing_lines"
    ADD CONSTRAINT "day_closing_lines_day_closing_id_fkey"
    FOREIGN KEY ("day_closing_id") REFERENCES "day_closings"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "day_closing_lines_inventory_item_id_fkey"
    FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
