import { runPrisma } from './reporting-seed';
import type { SeededStaff } from './business-day';

/**
 * Seeding and inspection support for story #351 — "Amend incorrect cash
 * movements without deleting history" (QA task #373).
 *
 * `business-day.ts` already seeds and reads cash movements for #123/#154, but
 * neither of its helpers can express what this story is about:
 *
 *  - `seedCashMovement()` returns nothing, and every assertion here needs the
 *    id of the row being amended (it is the URL segment of the amendment
 *    route and the value `amendsCashMovementId` must point at).
 *  - `readCashMovements()` projects a fixed column set that predates
 *    `amends_cash_movement_id`, so a correction and its original are
 *    indistinguishable through it.
 *
 * Both gaps are filled here rather than by widening the #123 fixtures, so the
 * existing suites keep the exact row shape their assertions were written
 * against.
 */

export interface SeedCashMovementInput {
  tradingDayId: string;
  kind: 'CASH_IN' | 'CASH_OUT' | 'EXPENSE';
  amountCents: number;
  description: string;
  category?: string | null;
  recordedBy?: SeededStaff | null;
}

/** Seed one drawer movement and return its id. */
export function seedCashMovementReturningId(
  input: SeedCashMovementInput,
): string {
  return runPrisma(`
    const input = ${JSON.stringify(input)};
    const movement = await prisma.cashMovement.create({
      data: {
        tradingDayId: input.tradingDayId,
        kind: input.kind,
        amountCents: input.amountCents,
        description: input.description,
        category: input.category ?? null,
        recordedByStaffMemberId: input.recordedBy ? input.recordedBy.id : null,
        recordedByNameSnapshot: input.recordedBy
          ? input.recordedBy.displayName
          : null,
        recordedAt: new Date(),
      },
    });
    process.stdout.write(movement.id);
  `);
}

export interface StoredAmendableCashMovement {
  id: string;
  tradingDayId: string;
  kind: 'CASH_IN' | 'CASH_OUT' | 'EXPENSE';
  amountCents: number;
  description: string;
  category: string | null;
  /** The row this one corrects — the supersession link, stored. */
  amendsCashMovementId: string | null;
  recordedByNameSnapshot: string | null;
}

/**
 * Every drawer movement in the database, oldest first, carrying the
 * supersession link.
 *
 * The criteria this file serves are stated as "records a new correction entry;
 * it does not edit, replace, hide or delete the original", so the assertions
 * are made against stored rows, not against the screen: a UI that merely hid
 * the original would pass a screen-only check.
 */
export function readAmendableCashMovements(): StoredAmendableCashMovement[] {
  const output = runPrisma(`
    const movements = await prisma.cashMovement.findMany({
      orderBy: [{ recordedAt: 'asc' }, { id: 'asc' }],
    });
    process.stdout.write(JSON.stringify(movements.map((movement) => ({
      id: movement.id,
      tradingDayId: movement.tradingDayId,
      kind: movement.kind,
      amountCents: movement.amountCents,
      description: movement.description,
      category: movement.category,
      amendsCashMovementId: movement.amendsCashMovementId,
      recordedByNameSnapshot: movement.recordedByNameSnapshot,
    }))));
  `);
  return JSON.parse(output) as StoredAmendableCashMovement[];
}

/** The stored row for one movement id, or `null` if it no longer exists. */
export function readCashMovementById(
  id: string,
): StoredAmendableCashMovement | null {
  return (
    readAmendableCashMovements().find((movement) => movement.id === id) ?? null
  );
}

/** The correction that supersedes `id`, or `null` while it is still effective. */
export function readCorrectionOf(
  id: string,
): StoredAmendableCashMovement | null {
  return (
    readAmendableCashMovements().find(
      (movement) => movement.amendsCashMovementId === id,
    ) ?? null
  );
}
