CREATE TYPE "EmploymentType" AS ENUM ('REGULAR', 'PROBATIONARY', 'TRAINEE', 'PART_TIME');
CREATE TYPE "SeparationReason" AS ENUM ('RESIGNED', 'TERMINATED');
CREATE TYPE "StaffCustomFieldType" AS ENUM ('TEXT', 'DATE', 'NUMBER', 'CHOICE');

CREATE TABLE "staff_employment_profiles" (
  "id" UUID NOT NULL, "staff_member_id" UUID NOT NULL, "start_date" DATE,
  "training_end_date" DATE, "probation_end_date" DATE, "third_month_review_date" DATE,
  "regularization_date" DATE, "employment_type" "EmploymentType", "end_date" DATE,
  "separation_reason" "SeparationReason", "birth_date" DATE, "contact_number" TEXT,
  "emergency_contact_name" TEXT, "emergency_contact_number" TEXT, "sss_number" TEXT,
  "philhealth_number" TEXT, "pagibig_number" TEXT, "tin_number" TEXT, "location_id" UUID,
  "updated_by_user_id" UUID NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_employment_profiles_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_employment_profiles_end_reason_check" CHECK (("end_date" IS NULL) = ("separation_reason" IS NULL)),
  CONSTRAINT "staff_employment_profiles_staff_member_id_fkey" FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_employment_profiles_location_id_fkey" FOREIGN KEY ("location_id") REFERENCES "locations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_employment_profiles_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "staff_employment_profiles_staff_member_id_key" ON "staff_employment_profiles"("staff_member_id");
CREATE INDEX "staff_employment_profiles_location_id_idx" ON "staff_employment_profiles"("location_id");

CREATE TABLE "staff_employment_type_changes" (
  "id" UUID NOT NULL, "staff_member_id" UUID NOT NULL, "employment_type" "EmploymentType" NOT NULL,
  "effective_date" DATE NOT NULL, "changed_by_user_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_employment_type_changes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_employment_type_changes_staff_member_id_fkey" FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_employment_type_changes_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "staff_employment_type_changes_staff_member_id_effective_date_idx" ON "staff_employment_type_changes"("staff_member_id", "effective_date");

CREATE TABLE "staff_custom_field_definitions" (
  "id" UUID NOT NULL, "label" TEXT NOT NULL, "field_type" "StaffCustomFieldType" NOT NULL,
  "choices" TEXT[] DEFAULT ARRAY[]::TEXT[], "sort_order" INTEGER NOT NULL, "is_archived" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_custom_field_definitions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "staff_custom_field_definitions_sort_order_idx" ON "staff_custom_field_definitions"("sort_order");
CREATE UNIQUE INDEX "staff_custom_field_definitions_active_label_key" ON "staff_custom_field_definitions"(LOWER("label")) WHERE NOT "is_archived";

CREATE TABLE "staff_custom_field_values" (
  "id" UUID NOT NULL, "staff_member_id" UUID NOT NULL, "definition_id" UUID NOT NULL,
  "value" TEXT NOT NULL, "updated_by_user_id" UUID NOT NULL, "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "staff_custom_field_values_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_custom_field_values_staff_member_id_fkey" FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_custom_field_values_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "staff_custom_field_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_custom_field_values_updated_by_user_id_fkey" FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "staff_custom_field_values_staff_member_id_definition_id_key" ON "staff_custom_field_values"("staff_member_id", "definition_id");
