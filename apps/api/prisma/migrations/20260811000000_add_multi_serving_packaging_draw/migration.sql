ALTER TABLE "products"
    ADD COLUMN "packaging_servings" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "sale_lines"
    ADD COLUMN "packaging_servings_snapshot" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "products"
    ADD CONSTRAINT "products_packaging_servings_check"
    CHECK ("packaging_servings" >= 1);

ALTER TABLE "sale_lines"
    ADD CONSTRAINT "sale_lines_packaging_servings_snapshot_check"
    CHECK ("packaging_servings_snapshot" >= 1);
