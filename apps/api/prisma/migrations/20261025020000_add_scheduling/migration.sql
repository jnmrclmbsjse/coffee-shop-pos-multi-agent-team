CREATE TABLE "schedule_weeks" (
  "id" UUID NOT NULL, "week_start_date" DATE NOT NULL, "location_id" UUID,
  "updated_by_user_id" UUID NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "schedule_weeks_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "schedule_weeks_sunday_check" CHECK (EXTRACT(DOW FROM "week_start_date") = 0),
  CONSTRAINT "schedule_weeks_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "schedule_weeks_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "schedule_weeks_location_id_week_start_date_key" ON "schedule_weeks"("location_id", "week_start_date") NULLS NOT DISTINCT;
CREATE INDEX "schedule_weeks_location_id_idx" ON "schedule_weeks"("location_id");

CREATE TABLE "schedule_shifts" (
  "id" UUID NOT NULL, "week_id" UUID NOT NULL, "shift_date" DATE NOT NULL,
  "staff_member_id" UUID NOT NULL, "start_minute" INTEGER NOT NULL, "end_minute" INTEGER NOT NULL,
  CONSTRAINT "schedule_shifts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "schedule_shifts_minute_range_check" CHECK (0 <= "start_minute" AND "start_minute" < "end_minute" AND "end_minute" <= 1440),
  CONSTRAINT "schedule_shifts_week_id_fkey" FOREIGN KEY ("week_id") REFERENCES "schedule_weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "schedule_shifts_staff_member_id_fkey" FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "schedule_shifts_week_id_shift_date_staff_member_id_key" ON "schedule_shifts"("week_id", "shift_date", "staff_member_id");

CREATE TABLE "schedule_day_notes" (
  "id" UUID NOT NULL, "week_id" UUID NOT NULL, "note_date" DATE NOT NULL, "event_note" TEXT NOT NULL,
  CONSTRAINT "schedule_day_notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "schedule_day_notes_week_id_fkey" FOREIGN KEY ("week_id") REFERENCES "schedule_weeks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "schedule_day_notes_week_id_note_date_key" ON "schedule_day_notes"("week_id", "note_date");
