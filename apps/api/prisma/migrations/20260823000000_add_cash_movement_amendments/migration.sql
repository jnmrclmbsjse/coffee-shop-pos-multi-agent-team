ALTER TABLE "cash_movements"
    ADD COLUMN "amends_cash_movement_id" UUID;

CREATE UNIQUE INDEX "cash_movements_amends_cash_movement_id_key"
    ON "cash_movements"("amends_cash_movement_id");

ALTER TABLE "cash_movements"
    ADD CONSTRAINT "cash_movements_amends_cash_movement_id_fkey"
    FOREIGN KEY ("amends_cash_movement_id") REFERENCES "cash_movements"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Existing writes have always required a positive integer. Add the database
-- backstop without assuming that historical rows satisfy the application rule.
ALTER TABLE "cash_movements"
    ADD CONSTRAINT "cash_movements_amount_cents_positive_check"
    CHECK ("amount_cents" > 0) NOT VALID;

ALTER TABLE "cash_movements"
    VALIDATE CONSTRAINT "cash_movements_amount_cents_positive_check";
