-- Align the database with schema.prisma so a later `prisma migrate dev`
-- generates nothing for these tables. Without this, the next generated
-- migration would drop the schedule week uniqueness index below.

-- @updatedAt columns carry no database default.
ALTER TABLE "staff_employment_profiles" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "staff_custom_field_definitions" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "staff_custom_field_values" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "schedule_weeks" ALTER COLUMN "updated_at" DROP DEFAULT;

-- Postgres truncated this name at 63 characters; use the name Prisma derives.
ALTER INDEX "staff_employment_type_changes_staff_member_id_effective_date_id"
  RENAME TO "staff_employment_type_changes_staff_member_id_effective_dat_idx";
