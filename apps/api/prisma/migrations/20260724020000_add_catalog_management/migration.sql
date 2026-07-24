-- Create the normalized category catalog before replacing products.category.
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "sort_weight" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "categories_sort_weight_idx" ON "categories"("sort_weight");
CREATE UNIQUE INDEX "categories_name_case_insensitive_key"
    ON "categories" (LOWER(BTRIM("name")));

INSERT INTO "categories" ("id", "name", "sort_weight")
SELECT
    gen_random_uuid(),
    normalized.name,
    ROW_NUMBER() OVER (ORDER BY LOWER(normalized.name)) - 1
FROM (
    SELECT DISTINCT ON (LOWER(source.name)) source.name
    FROM (
        SELECT COALESCE(
            NULLIF(BTRIM("category"), ''),
            'Uncategorized'
        ) AS name
        FROM "products"
    ) AS source
    ORDER BY LOWER(source.name), source.name
) AS normalized;

ALTER TABLE "products"
    ADD COLUMN "available" BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN "category_id" UUID;

UPDATE "products" AS product
SET "category_id" = category."id"
FROM "categories" AS category
WHERE LOWER(BTRIM(category."name")) =
    LOWER(COALESCE(NULLIF(BTRIM(product."category"), ''), 'Uncategorized'));

ALTER TABLE "products"
    ALTER COLUMN "category_id" SET NOT NULL,
    DROP COLUMN "category";

CREATE INDEX "products_category_id_idx" ON "products"("category_id");
ALTER TABLE "products"
    ADD CONSTRAINT "products_category_id_fkey"
    FOREIGN KEY ("category_id") REFERENCES "categories"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_variants"
    ADD COLUMN "sort_weight" INTEGER,
    ADD COLUMN "cup_inventory_item_id" UUID,
    ADD COLUMN "lid_inventory_item_id" UUID;

WITH ordered_variants AS (
    SELECT
        "id",
        ROW_NUMBER() OVER (PARTITION BY "product_id" ORDER BY "name", "id") - 1 AS weight
    FROM "product_variants"
)
UPDATE "product_variants" AS variant
SET "sort_weight" = ordered_variants.weight
FROM ordered_variants
WHERE variant."id" = ordered_variants."id";

ALTER TABLE "product_variants"
    ALTER COLUMN "sort_weight" SET NOT NULL;

CREATE INDEX "product_variants_cup_inventory_item_id_idx"
    ON "product_variants"("cup_inventory_item_id");
CREATE INDEX "product_variants_lid_inventory_item_id_idx"
    ON "product_variants"("lid_inventory_item_id");

ALTER TABLE "product_variants"
    ADD CONSTRAINT "product_variants_cup_inventory_item_id_fkey"
    FOREIGN KEY ("cup_inventory_item_id") REFERENCES "inventory_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "product_variants_lid_inventory_item_id_fkey"
    FOREIGN KEY ("lid_inventory_item_id") REFERENCES "inventory_items"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
