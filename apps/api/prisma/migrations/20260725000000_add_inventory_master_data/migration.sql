CREATE TYPE "CountMethod" AS ENUM ('QUANTITY', 'LEVEL');
CREATE TYPE "DayType" AS ENUM ('NORMAL', 'PEAK');

CREATE TABLE "stock_categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_weight" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "stock_categories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_categories_sort_weight_idx"
    ON "stock_categories"("sort_weight");
CREATE UNIQUE INDEX "stock_categories_name_case_insensitive_key"
    ON "stock_categories" (LOWER(BTRIM("name")));

INSERT INTO "stock_categories" ("id", "name", "sort_weight")
VALUES
    ('10000000-0000-4000-8000-000000000001', 'Water & Ice', 0),
    ('10000000-0000-4000-8000-000000000002', 'Cups', 1),
    ('10000000-0000-4000-8000-000000000003', 'Lids', 2),
    ('10000000-0000-4000-8000-000000000004', 'Dairies', 3),
    ('10000000-0000-4000-8000-000000000005', 'Others', 4);

ALTER TABLE "inventory_items"
    ADD COLUMN "category_id" UUID,
    ADD COLUMN "size" TEXT,
    ADD COLUMN "count_method" "CountMethod" NOT NULL DEFAULT 'QUANTITY',
    ADD COLUMN "critical" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "reconciled" BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "inventory_items"
SET "category_id" = '10000000-0000-4000-8000-000000000005';

ALTER TABLE "inventory_items"
    ALTER COLUMN "category_id" SET NOT NULL,
    ALTER COLUMN "count_method" DROP DEFAULT,
    ADD CONSTRAINT "inventory_items_reconciled_count_method_check"
        CHECK (NOT "reconciled" OR "count_method" = 'QUANTITY');

CREATE INDEX "inventory_items_category_id_idx"
    ON "inventory_items"("category_id");
ALTER TABLE "inventory_items"
    ADD CONSTRAINT "inventory_items_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "stock_categories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "par_levels" (
    "id" UUID NOT NULL,
    "inventory_item_id" UUID NOT NULL,
    "day_type" "DayType" NOT NULL,
    "par_qty" INTEGER NOT NULL,
    "low_threshold" INTEGER,
    "urgent_threshold" INTEGER,

    CONSTRAINT "par_levels_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "par_levels_non_negative_check" CHECK (
        "par_qty" >= 0
        AND ("low_threshold" IS NULL OR "low_threshold" >= 0)
        AND ("urgent_threshold" IS NULL OR "urgent_threshold" >= 0)
    ),
    CONSTRAINT "par_levels_urgent_requires_low_check" CHECK (
        "urgent_threshold" IS NULL OR "low_threshold" IS NOT NULL
    ),
    CONSTRAINT "par_levels_threshold_order_check" CHECK (
        ("low_threshold" IS NULL OR "low_threshold" <= "par_qty")
        AND (
            "urgent_threshold" IS NULL
            OR "urgent_threshold" <= "low_threshold"
        )
    )
);

CREATE UNIQUE INDEX "par_levels_inventory_item_id_day_type_key"
    ON "par_levels"("inventory_item_id", "day_type");
ALTER TABLE "par_levels"
    ADD CONSTRAINT "par_levels_inventory_item_id_fkey"
    FOREIGN KEY ("inventory_item_id") REFERENCES "inventory_items"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
