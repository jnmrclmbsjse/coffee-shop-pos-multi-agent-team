import { runPrisma } from './reporting-seed';

/**
 * Database-level reads and the one write that the product deliberately does not
 * expose, for the staff-account provisioning suite (story #287, QA task #299).
 *
 * Every refusal in ADR 0012 §2 is specified as "nothing is created and nothing
 * is changed". A message on screen does not prove that, so each refusal test
 * asserts the *negative* here: the roster member still has no `userId`, and no
 * `User` row exists for the attempted username. Those two facts are not
 * readable through any API surface — there is no admin user list in this story
 * (ADR 0012 §1) — so they are read straight from the tables.
 *
 * `unlinkStaffAccount` is the exception that writes. The story needs an account
 * that is *not* linked to a roster member so the no-inheritance criterion can
 * be tested, and unlinking is explicitly out of scope of #287 (ADR 0012 §1), so
 * no endpoint can produce that state. Creating the account through the real
 * endpoint and then dropping the link is the closest thing to the real row: the
 * password hash, role and `isActive` all come from the product's own code path.
 */

export interface StaffMemberLink {
  id: string;
  displayName: string;
  isActive: boolean;
  userId: string | null;
}

export interface StaffAccountRow {
  id: string;
  username: string;
  displayName: string;
  role: string;
  isActive: boolean;
  hasPin: boolean;
  linkedStaffMemberId: string | null;
}

export interface SaleAttribution {
  clientGeneratedId: string;
  dayOrderNumber: number;
  cashierStaffMemberId: string | null;
  cashierNameSnapshot: string | null;
}

/** The roster row as stored, including the account link column. */
export function readStaffMemberLink(staffMemberId: string): StaffMemberLink {
  const output = runPrisma(`
    const member = await prisma.staffMember.findUnique({
      where: { id: ${JSON.stringify(staffMemberId)} },
      select: { id: true, displayName: true, isActive: true, userId: true },
    });
    process.stdout.write(JSON.stringify(member));
  `);
  const member = JSON.parse(output) as StaffMemberLink | null;
  if (!member) throw new Error(`No staff member ${staffMemberId}`);
  return member;
}

/**
 * Every account whose username matches `username` ignoring case, with the
 * roster member it is linked to.
 *
 * Matching insensitively is the point: ADR 0012 §3 normalises usernames to
 * lower case on write precisely so that `Jane` and `jane` can never both exist,
 * and a case-sensitive lookup here would report "no account" for exactly the
 * row that proves the regression.
 */
export function readAccountsByUsername(username: string): StaffAccountRow[] {
  const output = runPrisma(`
    const users = await prisma.user.findMany({
      where: {
        username: { equals: ${JSON.stringify(username)}, mode: 'insensitive' },
      },
      select: {
        id: true,
        username: true,
        displayName: true,
        role: true,
        isActive: true,
        pinHash: true,
        staffMember: { select: { id: true } },
      },
    });
    process.stdout.write(JSON.stringify(users.map((user) => ({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      isActive: user.isActive,
      hasPin: user.pinHash !== null,
      linkedStaffMemberId: user.staffMember ? user.staffMember.id : null,
    }))));
  `);
  return JSON.parse(output) as StaffAccountRow[];
}

/** How many roster members point at this account (the 1:1 link, counted). */
export function countMembersLinkedToAccount(userId: string): number {
  return Number(
    runPrisma(`
      const count = await prisma.staffMember.count({
        where: { userId: ${JSON.stringify(userId)} },
      });
      process.stdout.write(String(count));
    `),
  );
}

/** Drop a roster member's account link, leaving the account itself intact. */
export function unlinkStaffAccount(staffMemberId: string): void {
  runPrisma(`
    await prisma.staffMember.update({
      where: { id: ${JSON.stringify(staffMemberId)} },
      data: { userId: null },
    });
  `);
}

/**
 * The device's current cashier selection, read from the append-only log.
 *
 * `GET /sales/active-cashier` needs a staff session, so it cannot answer "what
 * did the device keep after a *failed* sign-in", which is precisely when there
 * is no session to ask with.
 */
export function readLatestSelection(
  deviceId: string,
): { staffMemberId: string | null; displayName: string | null } | null {
  const output = runPrisma(`
    const latest = await prisma.cashierSelection.findFirst({
      where: { deviceId: ${JSON.stringify(deviceId)} },
      orderBy: { selectedAt: 'desc' },
      select: {
        staffMemberId: true,
        staffMember: { select: { displayName: true } },
      },
    });
    process.stdout.write(JSON.stringify(latest === null ? null : {
      staffMemberId: latest.staffMemberId,
      displayName: latest.staffMember ? latest.staffMember.displayName : null,
    }));
  `);
  return JSON.parse(output) as {
    staffMemberId: string | null;
    displayName: string | null;
  } | null;
}

/** How many rows the append-only selection log holds for a device. */
export function countSelections(deviceId: string): number {
  return Number(
    runPrisma(`
      const count = await prisma.cashierSelection.count({
        where: { deviceId: ${JSON.stringify(deviceId)} },
      });
      process.stdout.write(String(count));
    `),
  );
}

/**
 * The stored cashier attribution of every sale, oldest order number first.
 *
 * `readOrders()` in `take-order.ts` exposes `cashierNameSnapshot` but not
 * `cashierStaffMemberId`, and the criterion here is that *neither* moves.
 */
export function readSaleAttributions(): SaleAttribution[] {
  const output = runPrisma(`
    const sales = await prisma.sale.findMany({
      orderBy: [{ dayOrderNumber: 'asc' }],
      select: {
        clientGeneratedId: true,
        dayOrderNumber: true,
        cashierStaffMemberId: true,
        cashierNameSnapshot: true,
      },
    });
    process.stdout.write(JSON.stringify(sales));
  `);
  return JSON.parse(output) as SaleAttribution[];
}
