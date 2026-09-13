/**
 * Local dev seed: one clearly-named staff member with a full month of daily
 * records plus one of each adjustment kind, so a payslip can be generated and
 * its PNG export tested without hunting through leftover fixture staff.
 *
 * Not part of the app seed. Run it deliberately:
 *   cd apps/api && npx ts-node prisma/seed-payslip-demo.ts
 *
 * Re-running is safe: the staff member is matched by name and the records are
 * upserted per work date.
 */
import { PrismaClient, CompensationAdjustmentKind } from '@prisma/client';

const prisma = new PrismaClient();

const STAFF_NAME = 'Payslip Demo Barista';
const YEAR_MONTH = '2026-09';

async function main() {
  const user = await prisma.user.findFirst({
    where: { role: 'ADMIN' },
    select: { id: true },
  });
  if (!user) throw new Error('No admin user to attribute the records to.');

  const staff =
    (await prisma.staffMember.findFirst({
      where: { displayName: STAFF_NAME },
      select: { id: true },
    })) ??
    (await prisma.staffMember.create({
      data: { displayName: STAFF_NAME, isActive: true },
      select: { id: true },
    }));

  // A full month of work, so the payslip is tall enough to be worth exporting.
  const daysInMonth = new Date(2026, 9, 0).getDate(); // September 2026
  let created = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    const workDate = new Date(`${YEAR_MONTH}-${String(d).padStart(2, '0')}T00:00:00.000Z`);
    // Sundays off, so the sheet looks like a real roster rather than a block.
    if (workDate.getUTCDay() === 0) continue;
    await prisma.staffCompensationEntry.upsert({
      where: { staffMemberId_workDate: { staffMemberId: staff.id, workDate } },
      update: {},
      create: {
        staffMemberId: staff.id,
        workDate,
        salaryCents: 55_000,             // ₱550.00
        commissionCents: 1_200 + d * 45, // varies, so totals are not suspiciously round
        createdByUserId: user.id,
        updatedByUserId: user.id,
      },
    });
    created += 1;
  }

  const adjustments = [
    {
      kind: CompensationAdjustmentKind.ALLOWANCE,
      effectiveDate: new Date(`${YEAR_MONTH}-05T00:00:00.000Z`),
      amountCents: 30_000,
      description: 'Transportation allowance',
    },
    {
      kind: CompensationAdjustmentKind.BONUS,
      effectiveDate: new Date(`${YEAR_MONTH}-15T00:00:00.000Z`),
      amountCents: 75_000,
      description: 'Month-end performance bonus',
    },
    {
      kind: CompensationAdjustmentKind.ADVANCE,
      effectiveDate: new Date(`${YEAR_MONTH}-20T00:00:00.000Z`),
      amountCents: 20_000,
      description: 'Cash advance, deducted from net',
    },
  ];
  for (const adjustment of adjustments) {
    const existing = await prisma.staffCompensationAdjustment.findFirst({
      where: {
        staffMemberId: staff.id,
        kind: adjustment.kind,
        effectiveDate: adjustment.effectiveDate,
      },
      select: { id: true },
    });
    if (existing) continue;
    await prisma.staffCompensationAdjustment.create({
      data: {
        ...adjustment,
        staffMemberId: staff.id,
        createdByUserId: user.id,
        updatedByUserId: user.id,
      },
    });
  }

  console.log(`staff member: ${STAFF_NAME} (${staff.id})`);
  console.log(`daily records ensured: ${created} (Sundays skipped)`);
  console.log(`adjustments: ${adjustments.length} (allowance, bonus, advance)`);
  console.log(`\nCompensation → Payslips → pick "${STAFF_NAME}"`);
  console.log(`Range: ${YEAR_MONTH}-01 to ${YEAR_MONTH}-30, then Generate payslip → Download PNG`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
