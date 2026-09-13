-- A stock count may be corrected at most once, so a correction chain stays a
-- chain and never becomes a tree. The service already refuses a second
-- correction, but that check is a read followed by an insert: two concurrent
-- "Record another count" submissions against the same count can both pass it.
-- Uniqueness is the database-level guarantee, the same one ADR 0015 relies on
-- for cash movement amendments.
--
-- Postgres unique indexes admit any number of NULLs, so first counts (which
-- correct nothing) are unaffected. If existing rows already correct the same
-- count twice this statement fails loudly rather than choosing between them.
CREATE UNIQUE INDEX "stock_counts_corrects_stock_count_id_key"
    ON "stock_counts"("corrects_stock_count_id");
