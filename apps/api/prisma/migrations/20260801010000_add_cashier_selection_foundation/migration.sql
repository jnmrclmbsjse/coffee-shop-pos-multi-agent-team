-- The roster-to-account link is optional. Existing roster rows stay unlinked;
-- provisioning is explicit rather than inferred from names.
ALTER TABLE "staff_members"
    ADD COLUMN "user_id" UUID;

CREATE UNIQUE INDEX "staff_members_user_id_key"
    ON "staff_members"("user_id");

ALTER TABLE "staff_members"
    ADD CONSTRAINT "staff_members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only history: staff_member_id NULL records a deliberate clear.
CREATE TABLE "cashier_selections" (
    "id" UUID NOT NULL,
    "device_id" TEXT NOT NULL,
    "location_id" UUID,
    "staff_member_id" UUID,
    "selected_by_user_id" UUID NOT NULL,
    "selected_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cashier_selections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cashier_selections_device_id_selected_at_idx"
    ON "cashier_selections"("device_id", "selected_at");

ALTER TABLE "cashier_selections"
    ADD CONSTRAINT "cashier_selections_location_id_fkey"
    FOREIGN KEY ("location_id") REFERENCES "locations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cashier_selections"
    ADD CONSTRAINT "cashier_selections_staff_member_id_fkey"
    FOREIGN KEY ("staff_member_id") REFERENCES "staff_members"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "cashier_selections"
    ADD CONSTRAINT "cashier_selections_selected_by_user_id_fkey"
    FOREIGN KEY ("selected_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
