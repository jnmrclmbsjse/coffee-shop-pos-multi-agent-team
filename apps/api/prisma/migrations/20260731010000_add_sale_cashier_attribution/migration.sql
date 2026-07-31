-- Cashier attribution is optional by design: service must remain available
-- when no cashier is selected. Existing sales therefore remain unattributed.
ALTER TABLE "sales"
    ADD COLUMN "cashier_staff_member_id" UUID,
    ADD COLUMN "cashier_name_snapshot" TEXT;

ALTER TABLE "sales"
    ADD CONSTRAINT "sales_cashier_staff_member_id_fkey"
    FOREIGN KEY ("cashier_staff_member_id") REFERENCES "staff_members"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
