import { runPrisma } from './reporting-seed';

/**
 * Database-level reads and teardown for the staff-compensation suite
 * (story #309, QA task #316).
 *
 * Two things force direct table access here.
 *
 * 1. Every refusal in the story is specified as "without changing the existing
 *    record" / "nothing is saved". A message on screen does not prove that, and
 *    the list endpoint only ever returns what the read model *derives*, so the
 *    stored integer-cent columns are read straight from
 *    `staff_compensation_entries`. That is also the only way to catch a float
 *    bug: `salary_cents` must be exactly `123456`, not `123455.99999`.
 * 2. The roster has no delete surface (retention is deactivate-not-delete,
 *    ADR 0003), and `staff_compensation_entries.staff_member_id` is
 *    `ON DELETE RESTRICT`, so a fixture that tried to drop a roster member
 *    before its entries would fail confusingly. Teardown therefore deletes the
 *    entries and leaves the tagged roster members in place, exactly like the
 *    staff-roster suite does.
 */

export interface StoredCompensationEntry {
  id: string;
  staffMemberId: string;
  workDate: string;
  salaryCents: number;
  commissionCents: number;
}

/** Raw stored columns for one entry, or `null` if the row is gone. */
export function readStoredEntry(id: string): StoredCompensationEntry | null {
  const output = runPrisma(`
    const row = await prisma.staffCompensationEntry.findUnique({
      where: { id: ${JSON.stringify(id)} },
      select: {
        id: true,
        staffMemberId: true,
        workDate: true,
        salaryCents: true,
        commissionCents: true,
      },
    });
    process.stdout.write(JSON.stringify(row === null ? null : {
      ...row,
      workDate: row.workDate.toISOString().slice(0, 10),
    }));
  `);
  return JSON.parse(output) as StoredCompensationEntry | null;
}

/** Every stored entry for one roster member, oldest work date first. */
export function readStoredEntriesForStaff(
  staffMemberId: string,
): StoredCompensationEntry[] {
  const output = runPrisma(`
    const rows = await prisma.staffCompensationEntry.findMany({
      where: { staffMemberId: ${JSON.stringify(staffMemberId)} },
      orderBy: { workDate: 'asc' },
      select: {
        id: true,
        staffMemberId: true,
        workDate: true,
        salaryCents: true,
        commissionCents: true,
      },
    });
    process.stdout.write(JSON.stringify(rows.map((row) => ({
      ...row,
      workDate: row.workDate.toISOString().slice(0, 10),
    }))));
  `);
  return JSON.parse(output) as StoredCompensationEntry[];
}

/** How many entries exist for one roster member. */
export function countStoredEntriesForStaff(staffMemberId: string): number {
  return Number(
    runPrisma(`
      const count = await prisma.staffCompensationEntry.count({
        where: { staffMemberId: ${JSON.stringify(staffMemberId)} },
      });
      process.stdout.write(String(count));
    `),
  );
}

/** Remove every entry belonging to the given roster members (teardown only). */
export function deleteStoredEntriesForStaff(staffMemberIds: string[]): void {
  if (staffMemberIds.length === 0) return;
  runPrisma(`
    await prisma.staffCompensationEntry.deleteMany({
      where: { staffMemberId: { in: ${JSON.stringify(staffMemberIds)} } },
    });
  `);
}
