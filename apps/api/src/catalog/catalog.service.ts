import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { cents } from '@coffee-shop/shared';
import type {
  CatalogCategorySummary,
  Product,
  ProductListSort,
} from '@coffee-shop/shared';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type {
  CreateCategoryDto,
  CreateProductDto,
  ProductListQueryDto,
  ProductSizeDto,
  ReorderItemDto,
  UpdateCategoryDto,
  UpdateProductDto,
} from './catalog.dto';

const productInclude = {
  category: true,
  variants: {
    orderBy: [{ sortWeight: 'asc' }, { name: 'asc' }],
  },
} satisfies Prisma.ProductInclude;

type ProductRecord = Prisma.ProductGetPayload<{
  include: typeof productInclude;
}>;

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async listCategories(): Promise<CatalogCategorySummary[]> {
    const categories = await this.prisma.category.findMany({
      include: { _count: { select: { products: true } } },
      orderBy: [{ sortWeight: 'asc' }, { name: 'asc' }],
    });

    return categories.map(({ _count, ...category }) => ({
      ...category,
      productCount: _count.products,
    }));
  }

  async createCategory(
    input: CreateCategoryDto,
  ): Promise<CatalogCategorySummary> {
    await this.ensureCategoryNameAvailable(input.name);
    try {
      const category = await this.prisma.category.create({
        data: input,
        include: { _count: { select: { products: true } } },
      });
      const { _count, ...fields } = category;
      return { ...fields, productCount: _count.products };
    } catch (error: unknown) {
      this.rethrowCatalogConstraint(error);
    }
  }

  async updateCategory(
    id: string,
    input: UpdateCategoryDto,
  ): Promise<CatalogCategorySummary> {
    await this.requireCategory(id);
    if (input.name !== undefined) {
      await this.ensureCategoryNameAvailable(input.name, id);
    }

    try {
      const category = await this.prisma.category.update({
        where: { id },
        data: input,
        include: { _count: { select: { products: true } } },
      });
      const { _count, ...fields } = category;
      return { ...fields, productCount: _count.products };
    } catch (error: unknown) {
      this.rethrowCatalogConstraint(error);
    }
  }

  async reorderCategories(items: ReorderItemDto[]): Promise<void> {
    const ids = items.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('A category can appear only once');
    }

    const found = await this.prisma.category.count({
      where: { id: { in: ids } },
    });
    if (found !== ids.length) {
      throw new BadRequestException('One or more categories do not exist');
    }

    await this.prisma.$transaction(
      items.map(({ id, sortWeight }) =>
        this.prisma.category.update({
          where: { id },
          data: { sortWeight },
        }),
      ),
    );
  }

  async listProducts(query: ProductListQueryDto): Promise<Product[]> {
    const records = await this.prisma.product.findMany({
      where: {
        ...(query.search
          ? { name: { contains: query.search, mode: 'insensitive' } }
          : {}),
        ...(query.categoryId ? { categoryId: query.categoryId } : {}),
        ...(query.active === undefined ? {} : { active: query.active }),
      },
      include: productInclude,
      orderBy: this.productOrder(query.sort),
    });

    return records.map((record) => this.toProduct(record));
  }

  async getProduct(id: string): Promise<Product> {
    const product = await this.findProduct(this.prisma, id);
    if (!product) {
      throw new NotFoundException('Product not found');
    }
    return this.toProduct(product);
  }

  async createProduct(input: CreateProductDto): Promise<Product> {
    await this.requireCategory(input.categoryId);
    this.validateSizeNames(input.sizes);
    await this.validateInventoryMappings(this.prisma, input.sizes);

    const id = randomUUID();
    try {
      const product = await this.prisma.product.create({
        data: {
          id,
          sku: `PRODUCT-${id}`,
          categoryId: input.categoryId,
          name: input.name,
          active: input.active,
          available: input.available,
          variants: {
            create: input.sizes.map(
              ({
                name,
                priceCents,
                sortWeight,
                active,
                cupInventoryItemId,
                lidInventoryItemId,
              }) => ({
                name,
                priceCents,
                sortWeight,
                active,
                cupInventoryItemId,
                lidInventoryItemId,
              }),
            ),
          },
        },
        include: productInclude,
      });
      return this.toProduct(product);
    } catch (error: unknown) {
      this.rethrowCatalogConstraint(error);
    }
  }

  async updateProduct(
    id: string,
    input: UpdateProductDto,
  ): Promise<Product> {
    if (input.categoryId !== undefined) {
      await this.requireCategory(input.categoryId);
    }
    if (input.sizes !== undefined) {
      this.validateSizeNames(input.sizes);
      await this.validateInventoryMappings(this.prisma, input.sizes);
    }

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const existing = await transaction.product.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!existing) {
          throw new NotFoundException('Product not found');
        }

        const { sizes, ...productFields } = input;
        await transaction.product.update({
          where: { id },
          data: productFields,
        });

        if (sizes) {
          const suppliedIds = sizes.flatMap((size) =>
            size.id ? [size.id] : [],
          );
          if (new Set(suppliedIds).size !== suppliedIds.length) {
            throw new BadRequestException('A size can appear only once');
          }
          const ownedCount = await transaction.productVariant.count({
            where: { id: { in: suppliedIds }, productId: id },
          });
          if (ownedCount !== suppliedIds.length) {
            throw new BadRequestException(
              'One or more sizes do not belong to this product',
            );
          }

          for (const size of sizes) {
            const { id: sizeId, ...sizeFields } = size;
            if (sizeId) {
              await transaction.productVariant.update({
                where: { id: sizeId },
                data: sizeFields,
              });
            } else {
              await transaction.productVariant.create({
                data: { ...sizeFields, productId: id },
              });
            }
          }
        }

        const product = await this.findProduct(transaction, id);
        return this.toProduct(product!);
      });
    } catch (error: unknown) {
      this.rethrowCatalogConstraint(error);
    }
  }

  async updateAvailability(id: string, available: boolean): Promise<Product> {
    await this.requireProduct(id);
    const product = await this.prisma.product.update({
      where: { id },
      data: { available },
      include: productInclude,
    });
    return this.toProduct(product);
  }

  async reorderSizes(
    productId: string,
    items: ReorderItemDto[],
  ): Promise<void> {
    await this.requireProduct(productId);
    const ids = items.map(({ id }) => id);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('A size can appear only once');
    }
    const found = await this.prisma.productVariant.count({
      where: { productId, id: { in: ids } },
    });
    if (found !== ids.length) {
      throw new BadRequestException(
        'One or more sizes do not belong to this product',
      );
    }

    await this.prisma.$transaction(
      items.map(({ id, sortWeight }) =>
        this.prisma.productVariant.update({
          where: { id },
          data: { sortWeight },
        }),
      ),
    );
  }

  async removeSize(productId: string, sizeId: string): Promise<void> {
    await this.prisma.$transaction(async (transaction) => {
      const sizes = await transaction.productVariant.findMany({
        where: { productId },
        select: {
          id: true,
          _count: { select: { saleLines: true } },
        },
      });
      const size = sizes.find(({ id }) => id === sizeId);
      if (!size) {
        throw new NotFoundException('Product size not found');
      }
      if (sizes.length === 1) {
        throw new BadRequestException(
          'A product must retain at least one size',
        );
      }
      if (size._count.saleLines > 0) {
        throw new ConflictException(
          'This size cannot be removed because it is used by an existing sale',
        );
      }

      await transaction.productVariant.delete({ where: { id: sizeId } });
    });
  }

  private async ensureCategoryNameAvailable(
    name: string,
    excludingId?: string,
  ): Promise<void> {
    const duplicate = await this.prisma.category.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(excludingId ? { id: { not: excludingId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException(
        'A category with this name already exists',
      );
    }
  }

  private async requireCategory(id: string): Promise<void> {
    const category = await this.prisma.category.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!category) {
      throw new BadRequestException('Selected category does not exist');
    }
  }

  private async requireProduct(id: string): Promise<void> {
    const product = await this.prisma.product.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!product) {
      throw new NotFoundException('Product not found');
    }
  }

  private validateSizeNames(sizes: ProductSizeDto[]): void {
    const names = sizes.map((size) => size.name.toLocaleLowerCase('en-US'));
    if (new Set(names).size !== names.length) {
      throw new BadRequestException(
        'Size names must be unique within a product',
      );
    }
  }

  private async validateInventoryMappings(
    client: Prisma.TransactionClient | PrismaService,
    sizes: ProductSizeDto[],
  ): Promise<void> {
    const ids = [
      ...new Set(
        sizes.flatMap(({ cupInventoryItemId, lidInventoryItemId }) =>
          [cupInventoryItemId, lidInventoryItemId].filter(
            (id): id is string => Boolean(id),
          ),
        ),
      ),
    ];
    if (ids.length === 0) return;

    const activeItems = await client.inventoryItem.count({
      where: { id: { in: ids }, active: true },
    });
    if (activeItems !== ids.length) {
      throw new BadRequestException(
        'One or more Cup or Lid mappings are not selectable inventory items',
      );
    }
  }

  private findProduct(
    client: Prisma.TransactionClient | PrismaService,
    id: string,
  ): Promise<ProductRecord | null> {
    return client.product.findUnique({
      where: { id },
      include: productInclude,
    });
  }

  private productOrder(
    sort: ProductListSort | undefined,
  ): Prisma.ProductOrderByWithRelationInput[] {
    switch (sort) {
      case 'active':
        return [{ active: 'desc' }, { name: 'asc' }];
      case 'name':
        return [{ name: 'asc' }];
      case 'category':
      default:
        return [
          { category: { sortWeight: 'asc' } },
          { category: { name: 'asc' } },
          { name: 'asc' },
        ];
    }
  }

  private toProduct(record: ProductRecord): Product {
    return {
      id: record.id,
      sku: record.sku,
      name: record.name,
      categoryId: record.categoryId,
      category: record.category,
      active: record.active,
      available: record.available,
      variants: record.variants.map((variant) => ({
        id: variant.id,
        name: variant.name,
        priceCents: cents(variant.priceCents),
        sortWeight: variant.sortWeight,
        active: variant.active,
        cupInventoryItemId: variant.cupInventoryItemId,
        lidInventoryItemId: variant.lidInventoryItemId,
      })),
    };
  }

  private rethrowCatalogConstraint(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException(
        'A category or size with this name already exists',
      );
    }
    throw error;
  }
}
