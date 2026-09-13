-- Per-item note recorded during an inventory count, on either phase. Distinct
-- from stock_counts.notes, which covers the session as a whole: a barista needs
-- to say "these three lids were cracked" against the item, not the shift.
ALTER TABLE "stock_count_lines"
    ADD COLUMN "notes" TEXT;

-- Same backstops as stock_counts.notes. NOT VALID first so neither statement
-- scans the table, then validated; every existing row is NULL and passes.
ALTER TABLE "stock_count_lines"
    ADD CONSTRAINT "stock_count_lines_notes_length_check"
    CHECK ("notes" IS NULL OR char_length("notes") <= 500) NOT VALID;

ALTER TABLE "stock_count_lines"
    VALIDATE CONSTRAINT "stock_count_lines_notes_length_check";

ALTER TABLE "stock_count_lines"
    ADD CONSTRAINT "stock_count_lines_notes_not_blank_check"
    CHECK ("notes" IS NULL OR btrim("notes") <> '') NOT VALID;

ALTER TABLE "stock_count_lines"
    VALIDATE CONSTRAINT "stock_count_lines_notes_not_blank_check";
