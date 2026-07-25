import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { StockCategorySummary } from '@coffee-shop/shared';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateStockCategoryDto,
  ReorderStockCategoryItemDto,
  UpdateStockCategoryDto,
} from './inventory.dto';

type StockCategoryRecord = Prisma.StockCategoryGetPayload<{
  include: { _count: { select: { items: true } } };
}>;

@Injectable()
export class StockCategoriesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(): Promise<StockCategorySummary[]> {
    const categories = await this.prisma.stockCategory.findMany({
      include: { _count: { select: { items: true } } },
      orderBy: [{ sortWeight: 'asc' }, { name: 'asc' }],
    });

    return categories.map(({ _count, ...category }) => ({
      ...category,
      itemCount: _count.items,
    }));
  }

  async create(
    input: CreateStockCategoryDto,
  ): Promise<StockCategorySummary> {
    await this.ensureNameAvailable(input.name);
    try {
      return this.toSummary(
        await this.prisma.stockCategory.create({
          data: input,
          include: { _count: { select: { items: true } } },
        }),
      );
    } catch (error: unknown) {
      this.rethrowConstraint(error);
    }
  }

  async update(
    id: string,
    input: UpdateStockCategoryDto,
  ): Promise<StockCategorySummary> {
    await this.requireCategory(id);
    if (input.name !== undefined) {
      await this.ensureNameAvailable(input.name, id);
    }
    try {
      return this.toSummary(
        await this.prisma.stockCategory.update({
          where: { id },
          data: input,
          include: { _count: { select: { items: true } } },
        }),
      );
    } catch (error: unknown) {
      this.rethrowConstraint(error);
    }
  }

  async reorder(items: ReorderStockCategoryItemDto[]): Promise<void> {
    const ids = items.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('A stock category can appear only once');
    }
    const found = await this.prisma.stockCategory.count({
      where: { id: { in: ids } },
    });
    if (found !== ids.length) {
      throw new BadRequestException(
        'One or more stock categories do not exist',
      );
    }
    await this.prisma.$transaction(
      items.map(({ id, sortWeight }) =>
        this.prisma.stockCategory.update({
          where: { id },
          data: { sortWeight },
        }),
      ),
    );
  }

  async remove(id: string): Promise<void> {
    const category = await this.prisma.stockCategory.findUnique({
      where: { id },
      select: { id: true, _count: { select: { items: true } } },
    });
    if (!category) {
      throw new NotFoundException('Stock category not found');
    }
    if (category._count.items > 0) {
      throw new ConflictException({
        message:
          'This stock category cannot be deleted because it contains stock items',
        reason: 'STOCK_CATEGORY_NOT_EMPTY',
      });
    }
    try {
      await this.prisma.stockCategory.delete({ where: { id } });
    } catch (error: unknown) {
      this.rethrowConstraint(error);
    }
  }

  private async ensureNameAvailable(
    name: string,
    excludingId?: string,
  ): Promise<void> {
    const duplicate = await this.prisma.stockCategory.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(excludingId ? { id: { not: excludingId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException({
        message: 'A stock category with this name already exists',
        reason: 'STOCK_CATEGORY_NAME_TAKEN',
      });
    }
  }

  private async requireCategory(id: string): Promise<void> {
    const category = await this.prisma.stockCategory.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!category) {
      throw new NotFoundException('Stock category not found');
    }
  }

  private toSummary(
    category: StockCategoryRecord,
  ): StockCategorySummary {
    const { _count, ...fields } = category;
    return { ...fields, itemCount: _count.items };
  }

  private rethrowConstraint(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException({
        message: 'A stock category with this name already exists',
        reason: 'STOCK_CATEGORY_NAME_TAKEN',
      });
    }
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2003'
    ) {
      throw new ConflictException({
        message:
          'This stock category cannot be deleted because it contains stock items',
        reason: 'STOCK_CATEGORY_NOT_EMPTY',
      });
    }
    throw error;
  }
}
