import { runPrisma } from './reporting-seed';

/**
 * Seeding and raw-column reads for story #414 — base salary on the roster and
 * the suggested amounts on the Add daily record form (QA task #451).
 *
 * Three things force direct table access here, on top of the two reasons
 * `compensation.ts` already documents.
 *
 * 1. **`NULL` is not `0`.** ADR 0017 §1 makes "no base salary" and "a rate of
 *    zero" different values that must stay distinguishable end to end. The API
 *    shape reports both faithfully, but a `?? 0` collapsing them is exactly the
 *    bug these tests exist to catch, so `readStoredBaseSalary()` reads the
 *    `base_salary_cents` column itself and returns `null` as `null`.
 * 2. **The commission base is the whole shop's gross for a business date**, and
 *    the gross is read from the Sales/Orders read model with no per-run scope.
 *    "The form shows ₱2,750.00" is therefore only deterministic if the day the
 *    form looks at holds exactly the sales this test placed, which is why the
 *    suite clears the trading-day world (`resetTradingDays`) and builds the
 *    days it needs.
 * 3. **A trading day dated earlier than today cannot be opened through the
 *    UI.** `POST /orders` attaches to whichever day is OPEN regardless of its
 *    business date (`orders.service.ts` `requireOpenDay`), so a past-dated day
 *    is seeded here and the *sales on it* still go through the real capture
 *    API. That split matters: `grossSalesCents` sums `sale_payments` rows, and
 *    seeding those by hand would assert the fixture's arithmetic instead of the
 *    product's ([[e2e-seeded-sale-lines-hide-snapshot-bugs]]).
 */

// ---- catalog ----------------------------------------------------------------

export interface PricedVariant {
  variantId: string;
  productName: string;
  variantName: string;
  priceCents: number;
}

/**
 * One product per requested price, each with a single `Regular` variant at
 * exactly that price. Prices are chosen by the caller so a gross can be built
 * to the centavo (₱999.99 is a different band from ₱1,000.00) without ever
 * multiplying or dividing money in the fixture.
 */
export function seedPricedCatalog(
  tag: string,
  pricesCents: Record<string, number>,
): Record<string, PricedVariant> {
  const raw = runPrisma(`
    const fixture = ${JSON.stringify({ tag, pricesCents })};
    const category = await prisma.category.create({
      data: {
        name: 'QA451 ' + fixture.tag,
        sortWeight: 990451,
        active: true,
        freeUpsizeEligible: false,
      },
    });
    const out = {};
    let sku = 0;
    for (const [key, priceCents] of Object.entries(fixture.pricesCents)) {
      sku += 1;
      const product = await prisma.product.create({
        data: {
          sku: 'E2E-451-' + fixture.tag + '-' + sku,
          name: 'QA451 ' + key + ' ' + fixture.tag,
          categoryId: category.id,
          active: true,
          available: true,
        },
      });
      const variant = await prisma.productVariant.create({
        data: {
          productId: product.id,
          name: 'Regular',
          priceCents,
          sortWeight: 10,
          active: true,
        },
      });
      out[key] = {
        variantId: variant.id,
        productName: product.name,
        variantName: variant.name,
        priceCents,
      };
    }
    process.stdout.write(JSON.stringify(out));
  `);

  return JSON.parse(raw) as Record<string, PricedVariant>;
}

// ---- trading days -----------------------------------------------------------

export interface SeededSalesDay {
  id: string;
  businessDate: string;
}

/**
 * A roster member to attribute the open/close to. Created rather than reused so
 * the suite never depends on the dev database already holding staff, and named
 * per run so a previous run's member is never adopted.
 */
export function seedDayOpener(displayName: string): string {
  return runPrisma(`
    const member = await prisma.staffMember.create({
      data: { displayName: ${JSON.stringify(displayName)} },
    });
    process.stdout.write(member.id);
  `);
}

/** Open a trading day on an arbitrary business date. */
export function openSalesDay(
  businessDate: string,
  openedByStaffMemberId: string,
): SeededSalesDay {
  const output = runPrisma(`
    const input = ${JSON.stringify({ businessDate, openedByStaffMemberId })};
    const day = await prisma.tradingDay.create({
      data: {
        locationId: null,
        businessDate: new Date(input.businessDate + 'T00:00:00.000Z'),
        status: 'OPEN',
        openedAt: new Date(),
        openingFloatCents: 100000,
        openedByStaffMemberId: input.openedByStaffMemberId,
      },
    });
    process.stdout.write(JSON.stringify({
      id: day.id,
      businessDate: day.businessDate.toISOString().slice(0, 10),
    }));
  `);
  return JSON.parse(output) as SeededSalesDay;
}

/**
 * Close a trading day. Only the status matters to the gross read model, which
 * is the whole point of the criterion: an already-closed day's completed sales
 * must still count.
 */
export function closeSalesDay(
  dayId: string,
  closedByStaffMemberId: string,
): void {
  runPrisma(`
    await prisma.tradingDay.update({
      where: { id: ${JSON.stringify(dayId)} },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedByStaffMemberId: ${JSON.stringify(closedByStaffMemberId)},
      },
    });
  `);
}

/**
 * The raw payment total the gross read model sums, straight from the table.
 * Used to prove the figure on screen is the shop's real gross for the date and
 * not something the form computed for itself.
 */
export function readRawGrossCents(businessDate: string): number {
  return Number(
    runPrisma(`
      const rows = await prisma.$queryRawUnsafe(
        'SELECT COALESCE(SUM(p.amount_cents), 0)::text AS total ' +
        'FROM sale_payments p ' +
        'JOIN sales s ON s.id = p.sale_id ' +
        'JOIN trading_days d ON d.id = s.trading_day_id ' +
        'WHERE d.business_date = $1::date',
        ${JSON.stringify(businessDate)},
      );
      process.stdout.write(String(rows[0].total));
    `),
  );
}

// ---- base salary ------------------------------------------------------------

/**
 * `base_salary_cents` for one roster member exactly as stored: `null` when no
 * rate is held, an integer number of cents otherwise. Never `?? 0`.
 */
export function readStoredBaseSalary(staffMemberId: string): number | null {
  const output = runPrisma(`
    const row = await prisma.staffMember.findUnique({
      where: { id: ${JSON.stringify(staffMemberId)} },
      select: { baseSalaryCents: true },
    });
    process.stdout.write(JSON.stringify(row === null ? 'missing' : row.baseSalaryCents));
  `);
  const value = JSON.parse(output) as number | null | 'missing';
  if (value === 'missing') {
    throw new Error(`no staff member ${staffMemberId}`);
  }
  return value;
}

/** Remove the roster members this suite created (teardown only). */
export function deleteSeededStaff(staffMemberIds: string[]): void {
  if (staffMemberIds.length === 0) return;
  runPrisma(`
    await prisma.staffMember.deleteMany({
      where: { id: { in: ${JSON.stringify(staffMemberIds)} } },
    });
  `);
}

/** Remove the catalog rows this suite created (teardown only). */
export function deletePricedCatalog(tag: string): void {
  runPrisma(`
    const tag = ${JSON.stringify(tag)};
    const category = await prisma.category.findFirst({
      where: { name: 'QA451 ' + tag },
      select: { id: true },
    });
    if (category) {
      const products = await prisma.product.findMany({
        where: { categoryId: category.id },
        select: { id: true },
      });
      const productIds = products.map((product) => product.id);
      await prisma.productVariant.deleteMany({
        where: { productId: { in: productIds } },
      });
      await prisma.product.deleteMany({ where: { id: { in: productIds } } });
      await prisma.category.delete({ where: { id: category.id } });
    }
  `);
}

// ---- exactly one open day ---------------------------------------------------

/**
 * Make `businessDate` the single OPEN trading day, creating it if it does not
 * exist yet, and close every other day.
 *
 * `POST /orders` attaches a sale to whichever day is OPEN and refuses when none
 * is (`orders.service.ts` `requireOpenDay`), and the schema allows only one
 * OPEN day at a time. Building a gross on a chosen date therefore means making
 * that date the open day first, selling, and moving on — which is also why this
 * returns the day rather than asserting anything about it.
 *
 * Tests call this for themselves rather than inheriting whatever the previous
 * test left open, so the file's assertions do not depend on execution order.
 */
export function setSingleOpenDay(
  businessDate: string,
  openedByStaffMemberId: string,
): SeededSalesDay {
  const output = runPrisma(`
    const input = ${JSON.stringify({ businessDate, openedByStaffMemberId })};
    const date = new Date(input.businessDate + 'T00:00:00.000Z');
    await prisma.tradingDay.updateMany({
      where: { status: 'OPEN', businessDate: { not: date } },
      data: {
        status: 'CLOSED',
        closedAt: new Date(),
        closedByStaffMemberId: input.openedByStaffMemberId,
      },
    });
    const existing = await prisma.tradingDay.findFirst({
      where: { businessDate: date },
      select: { id: true },
    });
    const day = existing
      ? await prisma.tradingDay.update({
          where: { id: existing.id },
          data: { status: 'OPEN', closedAt: null, closedByStaffMemberId: null },
        })
      : await prisma.tradingDay.create({
          data: {
            locationId: null,
            businessDate: date,
            status: 'OPEN',
            openedAt: new Date(),
            openingFloatCents: 100000,
            openedByStaffMemberId: input.openedByStaffMemberId,
          },
        });
    process.stdout.write(JSON.stringify({
      id: day.id,
      businessDate: day.businessDate.toISOString().slice(0, 10),
    }));
  `);
  return JSON.parse(output) as SeededSalesDay;
}

/** The stored status of the day on one business date, or `null` if none. */
export function readDayStatus(businessDate: string): string | null {
  const output = runPrisma(`
    const day = await prisma.tradingDay.findFirst({
      where: { businessDate: new Date(${JSON.stringify(businessDate)} + 'T00:00:00.000Z') },
      select: { status: true },
    });
    process.stdout.write(JSON.stringify(day === null ? null : day.status));
  `);
  return JSON.parse(output) as string | null;
}

// ---- roster members with a known rate ---------------------------------------

export interface SeededRosterMember {
  id: string;
  displayName: string;
}

/**
 * A roster member whose `base_salary_cents` is set to exactly `baseSalaryCents`
 * — including the two values the story makes distinct, `null` ("no base
 * salary") and `0` ("a rate of zero").
 *
 * Seeded rather than entered through the staff dialog because the prefill tests
 * are about what the compensation form does with a stored value; the dialog's
 * own write path is covered separately, through the UI, where it is the
 * subject.
 */
export function seedRosterMember(
  displayName: string,
  baseSalaryCents: number | null,
): SeededRosterMember {
  const output = runPrisma(`
    const input = ${JSON.stringify({ displayName, baseSalaryCents })};
    const member = await prisma.staffMember.create({
      data: {
        displayName: input.displayName,
        isActive: true,
        baseSalaryCents: input.baseSalaryCents,
      },
    });
    process.stdout.write(JSON.stringify({
      id: member.id,
      displayName: member.displayName,
    }));
  `);
  return JSON.parse(output) as SeededRosterMember;
}

/** Overwrite one member's stored rate. `null` clears it. */
export function setStoredBaseSalary(
  staffMemberId: string,
  baseSalaryCents: number | null,
): void {
  runPrisma(`
    await prisma.staffMember.update({
      where: { id: ${JSON.stringify(staffMemberId)} },
      data: { baseSalaryCents: ${JSON.stringify(baseSalaryCents)} },
    });
  `);
}

/** The id of the roster member with this exact display name, or `null`. */
export function findRosterMemberId(displayName: string): string | null {
  const output = runPrisma(`
    const member = await prisma.staffMember.findFirst({
      where: { displayName: ${JSON.stringify(displayName)} },
      select: { id: true },
    });
    process.stdout.write(JSON.stringify(member === null ? null : member.id));
  `);
  return JSON.parse(output) as string | null;
}

/**
 * Drop every roster member whose display name starts with `prefix`, along with
 * the compensation rows that reference them.
 *
 * The roster has no delete surface (retention is deactivate-not-delete, ADR
 * 0003) so members this suite adds through the dialog can only be removed here.
 * A member still referenced by a table this suite does not own is left in place
 * rather than failing the run, exactly as `seedReportStaff` does.
 */
export function deleteRosterMembersByPrefix(prefix: string): void {
  runPrisma(`
    const prefix = ${JSON.stringify(prefix)};
    const members = await prisma.staffMember.findMany({
      where: { displayName: { startsWith: prefix } },
      select: { id: true },
    });
    const ids = members.map((member) => member.id);
    if (ids.length === 0) return;
    await prisma.staffCompensationEntry.deleteMany({
      where: { staffMemberId: { in: ids } },
    });
    await prisma.staffCompensationAdjustment.deleteMany({
      where: { staffMemberId: { in: ids } },
    });
    for (const id of ids) {
      try {
        await prisma.staffMember.delete({ where: { id } });
      } catch {
        // Referenced by a table this suite does not own — leave it.
      }
    }
  `);
}
