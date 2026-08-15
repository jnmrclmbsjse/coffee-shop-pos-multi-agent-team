import { Injectable } from '@nestjs/common';
import type {
  RestockStatus,
  RestockStatusResult,
  RestockStatusRow,
} from '@coffee-shop/shared';
import {
  CountMethod as SharedCountMethod,
  StockLevel as SharedStockLevel,
} from '@coffee-shop/shared';
import {
  CountMethod,
  Prisma,
  StockCountPhase,
  StockLevel,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { OpenTradingDay } from '../trading-day/trading-day.service';
import { TradingDayService } from '../trading-day/trading-day.service';
import { latestStockCountCorrection } from './packaging-reconciliation.service';

interface QuantityBands {
  parQty: number | null;
  lowThreshold: number | null;
  urgentThreshold: number | null;
}

const levelStatus: Record<StockLevel, RestockStatus> = {
  EMPTY: 'URGENT',
  LOW: 'URGENT',
  QUARTER: 'LOW',
  ONE_THIRD: 'LOW',
  HALF: 'BELOW_PAR',
  TWO_THIRDS: 'BELOW_PAR',
  THREE_QUARTERS: 'ENOUGH',
  FULL: 'ENOUGH',
};

const statusRank: Record<RestockStatus, number> = {
  URGENT: 0,
  LOW: 1,
  BELOW_PAR: 2,
  ENOUGH: 3,
};

export function quantityRestockStatus(
  counted: number,
  bands: QuantityBands | null,
): RestockStatus {
  if (bands === null) return 'ENOUGH';
  if (
    bands.urgentThreshold !== null &&
    counted <= bands.urgentThreshold
  ) {
    return 'URGENT';
  }
  if (
    bands.lowThreshold !== null &&
    counted <= bands.lowThreshold
  ) {
    return 'LOW';
  }
  if (bands.parQty !== null && counted < bands.parQty) {
    return 'BELOW_PAR';
  }
  return 'ENOUGH';
}

export function levelRestockStatus(
  level: StockLevel,
): RestockStatus {
  return levelStatus[level];
}

const restockCountInclude = {
  lines: {
    include: {
      inventoryItem: {
        include: {
          parLevels: true,
        },
      },
    },
  },
} satisfies Prisma.StockCountInclude;

type RestockCountRecord = Prisma.StockCountGetPayload<{
  include: typeof restockCountInclude;
}>;

type RestockParRecord =
  RestockCountRecord['lines'][number]['inventoryItem']['parLevels'][number];

@Injectable()
export class RestockService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tradingDayService: TradingDayService,
  ) {}

  async getStatus(): Promise<RestockStatusResult> {
    const openDay = await this.tradingDayService.findCurrentOpenDay();
    if (openDay === null) {
      return this.emptyResult();
    }

    return this.getStatusForDay(openDay);
  }

  async getStatusForDay(
    day: OpenTradingDay,
  ): Promise<RestockStatusResult> {
    const where = {
      locationId: day.locationId,
      businessDate: day.businessDate,
    };
    const counts = await this.prisma.stockCount.findMany({
      where: {
        ...where,
        phase: {
          in: [StockCountPhase.OPEN, StockCountPhase.CLOSE],
        },
      },
      include: restockCountInclude,
    });
    const count =
      latestStockCountCorrection(counts, StockCountPhase.CLOSE) ??
      latestStockCountCorrection(counts, StockCountPhase.OPEN);

    if (count === null) {
      return {
        ...this.emptyResult(),
        businessDay: this.tradingDayService.toResponse(day),
      };
    }

    const rows = count.lines.map((line) => {
      const par =
        line.inventoryItem.parLevels.find(
          (candidate) => candidate.dayType === day.dayType,
        ) ?? null;
      return this.toRow(line, par);
    });
    rows.sort((left, right) => {
      const byStatus =
        statusRank[left.status] - statusRank[right.status];
      if (byStatus !== 0) return byStatus;
      if (left.critical !== right.critical) {
        return left.critical ? -1 : 1;
      }
      return left.itemName.localeCompare(right.itemName);
    });

    return {
      businessDay: this.tradingDayService.toResponse(day),
      hasCount: true,
      selectedPhase:
        count.phase === StockCountPhase.CLOSE ? 'close' : 'open',
      selectedCountId: count.id,
      selectedCountRecordedAt: count.recordedAt.toISOString(),
      rows,
    };
  }

  private emptyResult(): RestockStatusResult {
    return {
      businessDay: this.tradingDayService.toResponse(null),
      hasCount: false,
      selectedPhase: null,
      selectedCountId: null,
      selectedCountRecordedAt: null,
      rows: [],
    };
  }

  private toRow(
    line: RestockCountRecord['lines'][number],
    par: RestockParRecord | null,
  ): RestockStatusRow {
    const item = line.inventoryItem;
    if (item.countMethod === CountMethod.LEVEL) {
      const level = line.level!;
      return {
        inventoryItemId: item.id,
        itemName: item.name,
        critical: item.critical,
        countMethod: SharedCountMethod.LEVEL,
        quantity: null,
        level: level as SharedStockLevel,
        par: null,
        status: levelRestockStatus(level),
      };
    }

    const quantity = line.quantity!;
    const quantityBands =
      par === null
        ? null
        : {
            parQty: par.parQty,
            lowThreshold: par.lowThreshold,
            urgentThreshold: par.urgentThreshold,
          };
    return {
      inventoryItemId: item.id,
      itemName: item.name,
      critical: item.critical,
      countMethod: SharedCountMethod.QUANTITY,
      quantity,
      level: null,
      par: quantityBands?.parQty ?? null,
      status: quantityRestockStatus(quantity, quantityBands),
    };
  }
}
