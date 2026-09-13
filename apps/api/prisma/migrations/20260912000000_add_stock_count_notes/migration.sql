-- Free-text note recorded during an inventory session, on either the opening or
-- the closing count. Nullable: every existing row predates the field, and a
-- note is optional going forward.
ALTER TABLE "stock_counts"
    ADD COLUMN "notes" TEXT;

-- Database backstop for the 500-character application limit. NOT VALID first so
-- the statement does not scan existing rows, then validated — existing rows are
-- all NULL and a NULL passes the check either way.
ALTER TABLE "stock_counts"
    ADD CONSTRAINT "stock_counts_notes_length_check"
    CHECK ("notes" IS NULL OR char_length("notes") <= 500) NOT VALID;

ALTER TABLE "stock_counts"
    VALIDATE CONSTRAINT "stock_counts_notes_length_check";

-- A blank note is not a note. The application trims input and stores NULL for
-- an empty string; this stops a whitespace-only value arriving by another path.
ALTER TABLE "stock_counts"
    ADD CONSTRAINT "stock_counts_notes_not_blank_check"
    CHECK ("notes" IS NULL OR btrim("notes") <> '') NOT VALID;

ALTER TABLE "stock_counts"
    VALIDATE CONSTRAINT "stock_counts_notes_not_blank_check";
