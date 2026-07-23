import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';
import { config } from 'dotenv';
import { resolve } from 'node:path';

config({ path: resolve(__dirname, '../../../.env') });

const prisma = new PrismaClient();

interface SeedUser {
  username: string;
  password: string;
  role: Role;
}

function readSeedUser(
  usernameVariable: string,
  passwordVariable: string,
  role: Role,
): SeedUser {
  const username = process.env[usernameVariable]?.trim();
  const password = process.env[passwordVariable];

  if (!username || password === undefined || password.length === 0) {
    throw new Error(
      `${usernameVariable} and ${passwordVariable} must both be set`,
    );
  }

  return { username: username.toLocaleLowerCase('en-US'), password, role };
}

function readOptionalSeedUser(
  usernameVariable: string,
  passwordVariable: string,
  role: Role,
): SeedUser | null {
  if (!process.env[usernameVariable] && !process.env[passwordVariable]) {
    return null;
  }

  return readSeedUser(usernameVariable, passwordVariable, role);
}

async function seedUser(user: SeedUser): Promise<void> {
  const passwordHash = await argon2.hash(user.password, {
    type: argon2.argon2id,
  });

  await prisma.user.upsert({
    where: { username: user.username },
    update: {
      passwordHash,
      role: user.role,
    },
    create: {
      username: user.username,
      passwordHash,
      role: user.role,
    },
  });
}

async function main(): Promise<void> {
  const admin = readSeedUser(
    'SEED_ADMIN_USERNAME',
    'SEED_ADMIN_PASSWORD',
    Role.ADMIN,
  );
  const staff = readOptionalSeedUser(
    'SEED_STAFF_USERNAME',
    'SEED_STAFF_PASSWORD',
    Role.STAFF,
  );

  await seedUser(admin);
  if (staff) {
    await seedUser(staff);
  }

  console.log(`Seeded administrator "${admin.username}"`);
  if (staff) {
    console.log(`Seeded staff user "${staff.username}"`);
  }
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
