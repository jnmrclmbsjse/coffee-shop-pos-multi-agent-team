CREATE TABLE "staff_compensation_entries" (
    "id" UUID NOT NULL,
    "staff_member_id" UUID NOT NULL,
    "work_date" DATE NOT NULL,
    "salary_cents" INTEGER NOT NULL,
    "commission_cents" INTEGER NOT NULL,
    "location_id" UUID,
    "created_by_user_id" UUID NOT NULL,
    "updated_by_user_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "staff_compensation_entries_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "staff_compensation_entries_non_negative_amounts_check"
        CHECK ("salary_cents" >= 0 AND "commission_cents" >= 0)
);

CREATE UNIQUE INDEX "staff_compensation_entries_staff_member_id_work_date_key"
    ON "staff_compensation_entries"("staff_member_id", "work_date");

CREATE INDEX "staff_compensation_entries_staff_member_id_work_date_idx"
    ON "staff_compensation_entries"("staff_member_id", "work_date");

ALTER TABLE "staff_compensation_entries"
    ADD CONSTRAINT "staff_compensation_entries_staff_member_id_fkey"
    FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "staff_compensation_entries"
    ADD CONSTRAINT "staff_compensation_entries_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "staff_compensation_entries"
    ADD CONSTRAINT "staff_compensation_entries_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "staff_compensation_entries"
    ADD CONSTRAINT "staff_compensation_entries_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
