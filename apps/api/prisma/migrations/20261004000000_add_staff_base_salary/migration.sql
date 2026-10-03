ALTER TABLE "staff_members"
ADD COLUMN "base_salary_cents" INTEGER;

ALTER TABLE "staff_members"
ADD CONSTRAINT "staff_members_base_salary_cents_check"
CHECK ("base_salary_cents" IS NULL OR "base_salary_cents" >= 0);
