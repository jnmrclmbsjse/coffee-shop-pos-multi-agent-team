import { PrismaClient, Role, TradingDayStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

interface SeedUser {
  username: string;
  displayName: string;
  password: string;
  pin?: string;
  role: Role;
}

const initialStockCategories = [
  { name: 'Water & Ice', sortWeight: 0 },
  { name: 'Cups', sortWeight: 1 },
  { name: 'Lids', sortWeight: 2 },
  { name: 'Dairies', sortWeight: 3 },
  { name: 'Others', sortWeight: 4 },
] as const;

const initialCatalogCategories = [
  { name: 'Coffee', sortWeight: 0, freeUpsizeEligible: true },
  { name: 'Other Drinks', sortWeight: 1, freeUpsizeEligible: false },
] as const;

function readSeedUser(
  usernameVariable: string,
  displayNameVariable: string,
  passwordVariable: string,
  role: Role,
  pinVariable?: string,
): SeedUser {
  const username = process.env[usernameVariable]?.trim();
  const displayName = process.env[displayNameVariable]?.trim();
  const password = process.env[passwordVariable];
  const pin = pinVariable ? process.env[pinVariable] : undefined;

  if (
    !username ||
    !displayName ||
    password === undefined ||
    password.length === 0
  ) {
    throw new Error(
      `${usernameVariable}, ${displayNameVariable}, and ${passwordVariable} must all be set`,
    );
  }

  if (pinVariable && !/^\d{4}$/.test(pin ?? '')) {
    throw new Error(`${pinVariable} must be exactly 4 digits`);
  }

  return {
    username: username.toLocaleLowerCase('en-US'),
    displayName,
    password,
    ...(pin ? { pin } : {}),
    role,
  };
}

async function seedUser(user: SeedUser): Promise<string> {
  const passwordHash = await argon2.hash(user.password, {
    type: argon2.argon2id,
  });
  const pinHash = user.pin
    ? await argon2.hash(user.pin, { type: argon2.argon2id })
    : null;

  const seededUser = await prisma.user.upsert({
    where: { username: user.username },
    update: {
      displayName: user.displayName,
      passwordHash,
      pinHash,
      isActive: true,
      role: user.role,
    },
    create: {
      username: user.username,
      displayName: user.displayName,
      passwordHash,
      pinHash,
      isActive: true,
      role: user.role,
    },
    select: { id: true },
  });

  return seededUser.id;
}

async function seedStockCategories(): Promise<void> {
  for (const category of initialStockCategories) {
    const existing = await prisma.stockCategory.findFirst({
      where: {
        name: { equals: category.name, mode: 'insensitive' },
      },
      select: { id: true },
    });

    if (existing) {
      await prisma.stockCategory.update({
        where: { id: existing.id },
        data: { sortWeight: category.sortWeight },
      });
    } else {
      await prisma.stockCategory.create({
        data: category,
      });
    }
  }
}

async function seedCatalogCategories(): Promise<void> {
  for (const category of initialCatalogCategories) {
    const existing = await prisma.category.findFirst({
      where: {
        name: { equals: category.name, mode: 'insensitive' },
      },
      select: { id: true },
    });

    if (existing) {
      await prisma.category.update({
        where: { id: existing.id },
        data: {
          sortWeight: category.sortWeight,
          freeUpsizeEligible: category.freeUpsizeEligible,
        },
      });
    } else {
      await prisma.category.create({ data: category });
    }
  }
}

async function seedStaffMember(
  displayName: string,
  userId: string | null = null,
): Promise<string> {
  const existing = await prisma.staffMember.findFirst({
    where: userId
      ? {
          OR: [
            { userId },
            {
              displayName: { equals: displayName, mode: 'insensitive' },
              locationId: null,
              userId: null,
            },
          ],
        }
      : {
          displayName: { equals: displayName, mode: 'insensitive' },
          locationId: null,
          userId: null,
        },
    select: { id: true },
  });

  if (existing) {
    await prisma.staffMember.update({
      where: { id: existing.id },
      data: { displayName, isActive: true, userId },
    });
    return existing.id;
  }

  const staffMember = await prisma.staffMember.create({
    data: { displayName, userId },
    select: { id: true },
  });

  return staffMember.id;
}

function currentBusinessDate(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
}

async function seedOpenTradingDay(
  openedByStaffMemberId: string,
): Promise<void> {
  const existing = await prisma.tradingDay.findFirst({
    where: {
      locationId: null,
      status: TradingDayStatus.OPEN,
    },
    select: { id: true },
  });

  if (existing) {
    return;
  }

  await prisma.tradingDay.create({
    data: {
      businessDate: currentBusinessDate(),
      status: TradingDayStatus.OPEN,
      openedAt: new Date(),
      openingFloatCents: 0,
      openedByStaffMemberId,
    },
  });
}

async function main(): Promise<void> {
  const admin = readSeedUser(
    'SEED_ADMIN_USERNAME',
    'SEED_ADMIN_DISPLAY_NAME',
    'SEED_ADMIN_PASSWORD',
    Role.ADMIN,
  );
  const staff = readSeedUser(
    'SEED_STAFF_USERNAME',
    'SEED_STAFF_DISPLAY_NAME',
    'SEED_STAFF_PASSWORD',
    Role.STAFF,
    'SEED_STAFF_PIN',
  );

  await seedUser(admin);
  const staffUserId = await seedUser(staff);
  await seedCatalogCategories();
  await seedStockCategories();
  const staffMemberId = await seedStaffMember(staff.displayName, staffUserId);
  await seedStaffMember('Unlinked Barista');
  await seedOpenTradingDay(staffMemberId);

  console.log(`Seeded administrator "${admin.username}"`);
  console.log(`Seeded staff user "${staff.username}"`);
  console.log('Seeded linked and unlinked active roster members');
  console.log('Seeded initial catalog categories');
  console.log('Seeded initial stock categories');
  console.log('Ensured an open trading day exists');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
