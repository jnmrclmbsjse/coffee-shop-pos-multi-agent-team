import { Injectable } from '@nestjs/common';
import { DayType as SharedDayType } from '@coffee-shop/shared';
import { DayType, TradingDayStatus } from '@prisma/client';
import type { CurrentOpenBusinessDay } from '@coffee-shop/shared';
import { PrismaService } from '../prisma/prisma.service';

export interface OpenTradingDay {
  id: string;
  locationId: string | null;
  businessDate: Date;
  dayType: DayType;
}

@Injectable()
export class TradingDayService {
  constructor(private readonly prisma: PrismaService) {}

  findCurrentOpenDay(): Promise<OpenTradingDay | null> {
    return this.prisma.tradingDay.findFirst({
      where: { status: TradingDayStatus.OPEN },
      orderBy: { openedAt: 'desc' },
      select: {
        id: true,
        locationId: true,
        businessDate: true,
        dayType: true,
      },
    });
  }

  async getCurrentOpenDay(): Promise<CurrentOpenBusinessDay> {
    return this.toResponse(await this.findCurrentOpenDay());
  }

  toResponse(day: OpenTradingDay | null): CurrentOpenBusinessDay {
    if (day === null) {
      return {
        isOpen: false,
        businessDate: null,
        dayType: null,
      };
    }

    return {
      isOpen: true,
      businessDate: day.businessDate.toISOString().slice(0, 10),
      dayType: day.dayType as SharedDayType,
    };
  }
}
