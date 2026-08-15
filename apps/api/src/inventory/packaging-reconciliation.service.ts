import { Injectable } from '@nestjs/common';
import type { PackagingReconciliationRow } from '@coffee-shop/shared';
import {
  CountMethod,
  MovementType,
  OrderStatus,
  Prisma,
  SaleKind,
  StockCountPhase,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export interface PackagingReconciliationTradingDay {
  id: string;
  locationId: string | null;
  businessDate: Date;
}

type PackagingReconciliationClient =
  | PrismaService
  | Prisma.TransactionClient;

const countSelect = {
  id: true,
  phase: true,
  recordedAt: true,
  correctsStockCountId: true,
  lines: {
    select: {
      inventoryItemId: true,
      quantity: true,
    },
  },
} satisfies Prisma.StockCountSelect;

type CountRecord = Prisma.StockCountGetPayload<{
  select: typeof countSelect;
}>;

interface CorrectableStockCount {
  id: string;
  phase: StockCountPhase;
  recordedAt: Date;
  correctsStockCountId: string | null;
}

export function latestStockCountCorrection<
  T extends CorrectableStockCount,
>(counts: T[], phase: StockCountPhase): T | null {
  const phaseCounts = counts.filter((count) => count.phase === phase);
  const correctedIds = new Set(
    phaseCounts.flatMap((count) =>
      count.correctsStockCountId === null
        ? []
        : [count.correctsStockCountId],
    ),
  );
  const chainLeaves = phaseCounts.filter(
    (count) => !correctedIds.has(count.id),
  );

  chainLeaves.sort(
    (left, right) =>
      right.recordedAt.getTime() - left.recordedAt.getTime() ||
      right.id.localeCompare(left.id),
  );
  return chainLeaves[0] || null;
}

/**
 * Computes the day-bounded cup/lid read model without storing a running stock
 * balance. LEVEL-counted items are excluded because they have no numeric
 * quantity that can participate in reconciliation arithmetic.
 */
@Injectable()
export class PackagingReconciliationService {
  constructor(private readonly prisma: PrismaService) {}

  async getForTradingDay(
    tradingDay: PackagingReconciliationTradingDay,
    client: PackagingReconciliationClient = this.prisma,
  ): Promise<PackagingReconciliationRow[]> {
    const stockScope = {
      locationId: tradingDay.locationId,
      businessDate: tradingDay.businessDate,
    };
    const [counts, movements, saleLines] = await Promise.all([
      client.stockCount.findMany({
        where: {
          ...stockScope,
          phase: {
            in: [StockCountPhase.OPEN, StockCountPhase.CLOSE],
          },
        },
        select: {
          ...countSelect,
        },
      }),
      client.stockMovement.findMany({
        where: {
          ...stockScope,
          type: {
            in: [MovementType.DELIVERY, MovementType.WASTAGE],
          },
        },
        select: {
          inventoryItemId: true,
          type: true,
          quantity: true,
        },
      }),
      client.saleLine.findMany({
        where: {
          sale: {
            tradingDayId: tradingDay.id,
            status: OrderStatus.COMPLETED,
            kind: SaleKind.PURCHASE,
            corrections: {
              none: { kind: SaleKind.VOID },
            },
          },
        },
        select: {
          quantity: true,
          packagingServingsSnapshot: true,
          productVariant: {
            select: {
              cupInventoryItemId: true,
              lidInventoryItemId: true,
            },
          },
        },
      }),
    ]);

    const participatingItemIds = new Set<string>();
    for (const count of counts) {
      for (const line of count.lines) {
        participatingItemIds.add(line.inventoryItemId);
      }
    }
    for (const movement of movements) {
      participatingItemIds.add(movement.inventoryItemId);
    }
    for (const line of saleLines) {
      if (line.productVariant.cupInventoryItemId !== null) {
        participatingItemIds.add(
          line.productVariant.cupInventoryItemId,
        );
      }
      if (line.productVariant.lidInventoryItemId !== null) {
        participatingItemIds.add(
          line.productVariant.lidInventoryItemId,
        );
      }
    }

    const items = await client.inventoryItem.findMany({
      where: {
        reconciled: true,
        countMethod: CountMethod.QUANTITY,
        OR: [
          { active: true },
          { id: { in: [...participatingItemIds] } },
        ],
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true },
    });

    if (items.length === 0) return [];

    const itemIds = items.map((item) => item.id);

    const opening = this.countQuantities(
      counts,
      StockCountPhase.OPEN,
    );
    const closing = this.countQuantities(
      counts,
      StockCountPhase.CLOSE,
    );
    const deliveries = this.zeroTotals(itemIds);
    const wastage = this.zeroTotals(itemIds);
    const sold = this.zeroTotals(itemIds);

    for (const movement of movements) {
      const totals =
        movement.type === MovementType.DELIVERY
          ? deliveries
          : wastage;
      this.add(totals, movement.inventoryItemId, movement.quantity);
    }

    for (const line of saleLines) {
      const packagingQuantity =
        line.quantity * line.packagingServingsSnapshot;
      this.add(
        sold,
        line.productVariant.cupInventoryItemId,
        packagingQuantity,
      );
      this.add(
        sold,
        line.productVariant.lidInventoryItemId,
        packagingQuantity,
      );
    }

    return items.map((item) => {
      const openingQty = opening.get(item.id);
      const actualQty = closing.get(item.id);
      const expectedQty =
        typeof openingQty === 'number'
          ? openingQty +
            deliveries.get(item.id)! -
            wastage.get(item.id)! -
            sold.get(item.id)!
          : null;
      const numericActual =
        typeof actualQty === 'number' ? actualQty : null;

      return {
        inventoryItemId: item.id,
        itemName: item.name,
        openingQty:
          typeof openingQty === 'number' ? openingQty : null,
        deliveriesQty: deliveries.get(item.id)!,
        wastageQty: wastage.get(item.id)!,
        soldQty: sold.get(item.id)!,
        expectedQty,
        actualQty: numericActual,
        varianceQty:
          expectedQty === null || numericActual === null
            ? null
            : numericActual - expectedQty,
      };
    });
  }

  private countQuantities(
    counts: CountRecord[],
    phase: StockCountPhase,
  ): Map<string, number | null> {
    const count = latestStockCountCorrection(counts, phase);
    if (count === null) return new Map();

    return new Map(
      count.lines.map((line) => [
        line.inventoryItemId,
        line.quantity,
      ]),
    );
  }

  private zeroTotals(itemIds: string[]): Map<string, number> {
    return new Map(itemIds.map((id) => [id, 0]));
  }

  private add(
    totals: Map<string, number>,
    itemId: string | null,
    quantity: number,
  ): void {
    if (itemId === null) return;
    const current = totals.get(itemId);
    if (current === undefined) return;
    totals.set(itemId, current + quantity);
  }
}
