CREATE TYPE "CompensationAdjustmentKind" AS ENUM ('ADVANCE', 'ALLOWANCE', 'BONUS');

CREATE TABLE "staff_compensation_adjustments" (
    "id" UUID NOT NULL,
    "staff_member_id" UUID NOT NULL,
    "kind" "CompensationAdjustmentKind" NOT NULL,
    "effective_date" DATE NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "location_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_compensation_adjustments_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_compensation_adjustments_positive_amount_check"
        CHECK ("amount_cents" >= 1)
);

CREATE INDEX "staff_compensation_adjustments_staff_member_id_effective_date_idx"
    ON "staff_compensation_adjustments"("staff_member_id", "effective_date");

ALTER TABLE "staff_compensation_adjustments"
    ADD CONSTRAINT "staff_compensation_adjustments_staff_member_id_fkey"
    FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "staff_compensation_adjustments"
    ADD CONSTRAINT "staff_compensation_adjustments_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "staff_compensation_adjustments"
    ADD CONSTRAINT "staff_compensation_adjustments_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "staff_compensation_adjustments"
    ADD CONSTRAINT "staff_compensation_adjustments_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
