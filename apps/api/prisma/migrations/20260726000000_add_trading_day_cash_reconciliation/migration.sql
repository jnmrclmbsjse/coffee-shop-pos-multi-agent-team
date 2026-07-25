CREATE TYPE "TradingDayStatus" AS ENUM ('OPEN', 'CLOSED');
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'ONLINE');

CREATE TABLE "trading_days" (
    "id" UUID NOT NULL,
    "location_id" UUID,
    "business_date" DATE NOT NULL,
    "status" "TradingDayStatus" NOT NULL,
    "opened_at" TIMESTAMP(3) NOT NULL,
    "closed_at" TIMESTAMP(3),
    "opening_float_cents" INTEGER NOT NULL,
    "opened_by_staff_member_id" UUID NOT NULL,
    "closed_by_staff_member_id" UUID,

    CONSTRAINT "trading_days_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "trading_days_location_id_business_date_idx"
    ON "trading_days"("location_id", "business_date");
CREATE UNIQUE INDEX "trading_days_one_open_per_location_key"
    ON "trading_days"("location_id") NULLS NOT DISTINCT
    WHERE "status" = 'OPEN';

CREATE TABLE "cash_counts" (
    "id" UUID NOT NULL,
    "trading_day_id" UUID NOT NULL,
    "counted_cents" INTEGER NOT NULL,
    "counted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "counted_by_staff_member_id" UUID NOT NULL,

    CONSTRAINT "cash_counts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_counts_trading_day_id_counted_at_idx"
    ON "cash_counts"("trading_day_id", "counted_at");

CREATE TABLE "cash_expenses" (
    "id" UUID NOT NULL,
    "trading_day_id" UUID NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_expenses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cash_expenses_trading_day_id_recorded_at_idx"
    ON "cash_expenses"("trading_day_id", "recorded_at");

ALTER TABLE "sales"
    ADD COLUMN "trading_day_id" UUID NOT NULL,
    ADD COLUMN "cash_tip_cents" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "sales_trading_day_id_idx"
    ON "sales"("trading_day_id");

CREATE TABLE "sale_payments" (
    "id" UUID NOT NULL,
    "sale_id" UUID NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "amount_cents" INTEGER NOT NULL,

    CONSTRAINT "sale_payments_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sale_payments_sale_id_method_key"
    ON "sale_payments"("sale_id", "method");

ALTER TABLE "trading_days"
    ADD CONSTRAINT "trading_days_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "trading_days_opened_by_staff_member_id_fkey"
    FOREIGN KEY ("opened_by_staff_member_id") REFERENCES "staff_members"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "trading_days_closed_by_staff_member_id_fkey"
    FOREIGN KEY ("closed_by_staff_member_id") REFERENCES "staff_members"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cash_counts"
    ADD CONSTRAINT "cash_counts_trading_day_id_fkey"
    FOREIGN KEY ("trading_day_id") REFERENCES "trading_days"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "cash_counts_counted_by_staff_member_id_fkey"
    FOREIGN KEY ("counted_by_staff_member_id") REFERENCES "staff_members"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cash_expenses"
    ADD CONSTRAINT "cash_expenses_trading_day_id_fkey"
    FOREIGN KEY ("trading_day_id") REFERENCES "trading_days"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sales"
    ADD CONSTRAINT "sales_trading_day_id_fkey"
    FOREIGN KEY ("trading_day_id") REFERENCES "trading_days"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "sale_payments"
    ADD CONSTRAINT "sale_payments_sale_id_fkey"
    FOREIGN KEY ("sale_id") REFERENCES "sales"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
