ALTER TABLE "par_levels"
    DROP CONSTRAINT "par_levels_non_negative_check",
    DROP CONSTRAINT "par_levels_threshold_order_check",
    ALTER COLUMN "par_qty" DROP NOT NULL,
    ADD COLUMN "par_level" "StockLevel";

ALTER TABLE "par_levels"
    ADD CONSTRAINT "par_levels_non_negative_check" CHECK (
        "par_qty" IS NULL
        OR (
            "par_qty" >= 0
            AND ("low_threshold" IS NULL OR "low_threshold" >= 0)
            AND ("urgent_threshold" IS NULL OR "urgent_threshold" >= 0)
        )
    ),
    ADD CONSTRAINT "par_levels_threshold_order_check" CHECK (
        "par_qty" IS NULL
        OR (
            ("low_threshold" IS NULL OR "low_threshold" <= "par_qty")
            AND (
                "urgent_threshold" IS NULL
                OR "urgent_threshold" <= "low_threshold"
            )
        )
    ),
    ADD CONSTRAINT "par_levels_value_exclusivity_check" CHECK (
        ("par_qty" IS NOT NULL) <> ("par_level" IS NOT NULL)
        AND (
            "par_level" IS NULL
            OR (
                "low_threshold" IS NULL
                AND "urgent_threshold" IS NULL
            )
        )
    );

-- Agreement with inventory_items.count_method is a cross-table invariant and
-- cannot be expressed as a par_levels CHECK constraint. The API service
-- validates that invariant before every write.
