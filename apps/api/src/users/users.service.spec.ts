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
});
