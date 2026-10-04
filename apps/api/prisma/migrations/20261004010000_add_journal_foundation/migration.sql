CREATE TYPE "JournalSuggestionKind" AS ENUM (
    'NONE',
    'RENT_PERCENT_OF_ROUNDED_GROSS',
    'CHAIR_FLAT_ABOVE_THRESHOLD'
);

CREATE TABLE "journal_ledgers" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "starting_balance_cents" INTEGER NOT NULL DEFAULT 0,
    "suggestion_kind" "JournalSuggestionKind" NOT NULL,
    "is_built_in" BOOLEAN NOT NULL DEFAULT false,
    "location_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_ledgers_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "journal_deposits" (
    "id" UUID NOT NULL,
    "ledger_id" UUID NOT NULL,
    "business_date" DATE NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "note" TEXT,
    "location_id" UUID,
    "recorded_by_user_id" UUID NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_user_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_deposits_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "journal_deposits_amount_cents_check"
        CHECK ("amount_cents" >= 0)
);

CREATE TABLE "journal_withdrawals" (
    "id" UUID NOT NULL,
    "ledger_id" UUID NOT NULL,
    "withdrawn_on" DATE NOT NULL,
    "amount_cents" INTEGER NOT NULL,
    "note" TEXT,
    "location_id" UUID,
    "recorded_by_user_id" UUID NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_by_user_id" UUID NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_withdrawals_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "journal_withdrawals_amount_cents_check"
        CHECK ("amount_cents" >= 1)
);

CREATE TABLE "journal_suggestion_rates" (
    "id" UUID NOT NULL,
    "ledger_id" UUID NOT NULL,
    "effective_from" DATE NOT NULL,
    "rent_percent_basis_points" INTEGER,
    "chair_amount_cents" INTEGER,
    "chair_threshold_cents" INTEGER,
    "location_id" UUID,
    "created_by_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_suggestion_rates_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "journal_suggestion_rates_rent_percent_basis_points_check"
        CHECK (
            "rent_percent_basis_points" IS NULL
            OR "rent_percent_basis_points" BETWEEN 0 AND 10000
        ),
    CONSTRAINT "journal_suggestion_rates_chair_amount_cents_check"
        CHECK ("chair_amount_cents" IS NULL OR "chair_amount_cents" >= 0),
    CONSTRAINT "journal_suggestion_rates_chair_threshold_cents_check"
        CHECK (
            "chair_threshold_cents" IS NULL
            OR "chair_threshold_cents" >= 0
        )
);

CREATE UNIQUE INDEX "journal_ledgers_name_key"
    ON "journal_ledgers"("name");
CREATE INDEX "journal_ledgers_location_id_idx"
    ON "journal_ledgers"("location_id");

CREATE UNIQUE INDEX "journal_deposits_ledger_id_business_date_key"
    ON "journal_deposits"("ledger_id", "business_date");
CREATE INDEX "journal_deposits_location_id_idx"
    ON "journal_deposits"("location_id");

CREATE INDEX "journal_withdrawals_ledger_id_withdrawn_on_idx"
    ON "journal_withdrawals"("ledger_id", "withdrawn_on");
CREATE INDEX "journal_withdrawals_location_id_idx"
    ON "journal_withdrawals"("location_id");

CREATE UNIQUE INDEX "journal_suggestion_rates_ledger_id_effective_from_key"
    ON "journal_suggestion_rates"("ledger_id", "effective_from");
CREATE INDEX "journal_suggestion_rates_location_id_idx"
    ON "journal_suggestion_rates"("location_id");

ALTER TABLE "journal_ledgers"
    ADD CONSTRAINT "journal_ledgers_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "journal_deposits"
    ADD CONSTRAINT "journal_deposits_ledger_id_fkey"
    FOREIGN KEY ("ledger_id") REFERENCES "journal_ledgers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "journal_deposits_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "journal_deposits_recorded_by_user_id_fkey"
    FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "journal_deposits_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "journal_withdrawals"
    ADD CONSTRAINT "journal_withdrawals_ledger_id_fkey"
    FOREIGN KEY ("ledger_id") REFERENCES "journal_ledgers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "journal_withdrawals_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "journal_withdrawals_recorded_by_user_id_fkey"
    FOREIGN KEY ("recorded_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "journal_withdrawals_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "journal_suggestion_rates"
    ADD CONSTRAINT "journal_suggestion_rates_ledger_id_fkey"
    FOREIGN KEY ("ledger_id") REFERENCES "journal_ledgers"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "journal_suggestion_rates_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,
    ADD CONSTRAINT "journal_suggestion_rates_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

WITH journal_start_date AS (
    SELECT COALESCE(
        MIN("business_date"),
        DATE '2026-10-04'
    ) AS "start_date"
    FROM "trading_days"
)
INSERT INTO "journal_ledgers" (
    "id",
    "name",
    "start_date",
    "starting_balance_cents",
    "suggestion_kind",
    "is_built_in"
)
SELECT
    gen_random_uuid(),
    seed."name",
    journal_start_date."start_date",
    0,
    seed."suggestion_kind"::"JournalSuggestionKind",
    true
FROM journal_start_date
CROSS JOIN (
    VALUES
        ('Rent', 'RENT_PERCENT_OF_ROUNDED_GROSS'),
        ('Chair', 'CHAIR_FLAT_ABOVE_THRESHOLD')
) AS seed("name", "suggestion_kind")
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "journal_suggestion_rates" (
    "id",
    "ledger_id",
    "effective_from",
    "rent_percent_basis_points",
    "chair_amount_cents",
    "chair_threshold_cents"
)
SELECT
    gen_random_uuid(),
    ledger."id",
    ledger."start_date",
    CASE WHEN ledger."name" = 'Rent' THEN 1000 END,
    CASE WHEN ledger."name" = 'Chair' THEN 10000 END,
    CASE WHEN ledger."name" = 'Chair' THEN 300000 END
FROM "journal_ledgers" AS ledger
WHERE ledger."is_built_in" = true
  AND ledger."name" IN ('Rent', 'Chair')
ON CONFLICT ("ledger_id", "effective_from") DO NOTHING;
