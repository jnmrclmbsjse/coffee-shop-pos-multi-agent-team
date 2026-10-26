ALTER TABLE "staff_compensation_entries"
ADD COLUMN "personal_commission_cents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "staff_compensation_entries"
ADD CONSTRAINT "staff_compensation_entries_personal_commission_non_negative_check"
CHECK ("personal_commission_cents" >= 0);

CREATE TABLE "staff_commission_rates" (
  "id" UUID NOT NULL,
  "staff_member_id" UUID NOT NULL,
  "effective_from" DATE NOT NULL,
  "rate_per_band_cents" INTEGER NOT NULL,
  "location_id" UUID,
  "created_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_commission_rates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_commission_rates_rate_non_negative_check" CHECK ("rate_per_band_cents" >= 0),
  CONSTRAINT "staff_commission_rates_staff_member_id_fkey" FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_commission_rates_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_commission_rates_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "staff_commission_rates_staff_member_id_effective_from_key" ON "staff_commission_rates"("staff_member_id", "effective_from");
CREATE INDEX "staff_commission_rates_location_id_idx" ON "staff_commission_rates"("location_id");
