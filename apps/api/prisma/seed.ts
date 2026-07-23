import { PrismaClient, Role } from '@prisma/client';
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

async function seedUser(user: SeedUser): Promise<void> {
  const passwordHash = await argon2.hash(user.password, {
    type: argon2.argon2id,
  });
  const pinHash = user.pin
    ? await argon2.hash(user.pin, { type: argon2.argon2id })
    : null;

  await prisma.user.upsert({
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
  await seedUser(staff);

  console.log(`Seeded administrator "${admin.username}"`);
  console.log(`Seeded staff user "${staff.username}"`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
