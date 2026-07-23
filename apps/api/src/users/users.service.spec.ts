import type { PrismaService } from '../prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  it('looks up a trimmed username without regard to case', async () => {
    const findFirst = jest.fn().mockResolvedValue(null);
    const prisma = {
      user: { findFirst },
    } as unknown as PrismaService;
    const service = new UsersService(prisma);

    await service.findByUsername('  AdMiN  ');

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        username: {
          equals: 'AdMiN',
          mode: 'insensitive',
        },
      },
    });
  });

  it('looks up a staff account by its exact identifier', async () => {
    const findUnique = jest.fn().mockResolvedValue(null);
    const prisma = {
      user: { findUnique },
    } as unknown as PrismaService;
    const service = new UsersService(prisma);

    await service.findById('staff-id');

    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'staff-id' },
    });
  });
});
