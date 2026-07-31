import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import {
  addMoney,
  calculateCashReconciliation,
  cents,
  DayType as SharedDayType,
  CashMovementKind as SharedCashMovementKind,
  TradingDayStatus as SharedTradingDayStatus,
} from '@coffee-shop/shared';
import type {
  BusinessDayList,
  CashMovement as CashMovementResponse,
  CashMovementList,
  CashReconciliation,
  CurrentOpenBusinessDay,
  DayClosing as DayClosingResponse,
  TradingDayClosingSummary,
} from '@coffee-shop/shared';
import {
  CashMovementKind,
  DayType,
  Prisma,
  StockCountPhase,
  TradingDayStatus,
} from '@prisma/client';
import { PackagingReconciliationService } from '../inventory/packaging-reconciliation.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CloseBusinessDayDto,
  CreateCashMovementDto,
  OpenBusinessDayDto,
} from './trading-day.dto';

export interface OpenTradingDay {
  id: string;
  locationId: string | null;
  businessDate: Date;
  dayType: DayType;
  openingFloatCents: number;
  openedAt: Date;
  openedByStaffMember: {
    displayName: string;
  };
}

type TradingDayClient = PrismaService | Prisma.TransactionClient;

const openTradingDaySelect = {
  id: true,
  locationId: true,
  businessDate: true,
  dayType: true,
  openingFloatCents: true,
  openedAt: true,
  openedByStaffMember: {
    select: {
      displayName: true,
    },
  },
} satisfies Prisma.TradingDaySelect;

const dayClosingInclude = {
  lines: {
    orderBy: [{ itemNameSnapshot: 'asc' }, { inventoryItemId: 'asc' }],
  },
} satisfies Prisma.DayClosingInclude;

type DayClosingRecord = Prisma.DayClosingGetPayload<{
  include: typeof dayClosingInclude;
}>;

type CashMovementRecord = Prisma.CashMovementGetPayload<Record<string, never>>;

@Injectable()
export class TradingDayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly packagingReconciliation: PackagingReconciliationService,
  ) {}

  findCurrentOpenDay(): Promise<OpenTradingDay | null> {
    return this.prisma.tradingDay.findFirst({
      where: { status: TradingDayStatus.OPEN },
      orderBy: { openedAt: 'desc' },
      select: openTradingDaySelect,
    });
  }

  async getCurrentOpenDay(): Promise<CurrentOpenBusinessDay> {
    return this.toResponse(await this.findCurrentOpenDay());
  }

  async listBusinessDays(): Promise<BusinessDayList> {
    const days = await this.prisma.tradingDay.findMany({
      orderBy: [
        { businessDate: 'desc' },
        { openedAt: 'desc' },
        { id: 'asc' },
      ],
      select: {
        id: true,
        businessDate: true,
        status: true,
      },
    });

    return {
      items: days.map((day) => ({
        id: day.id,
        businessDate: this.toDateOnly(day.businessDate),
        status: day.status as SharedTradingDayStatus,
      })),
      currentOpenBusinessDayId:
        days.find((day) => day.status === TradingDayStatus.OPEN)?.id ??
        null,
    };
  }

  async open(input: OpenBusinessDayDto): Promise<CurrentOpenBusinessDay> {
    this.validateOpenInput(input);
    const businessDate = this.parseBusinessDate(input.businessDate);

    try {
      const day = await this.prisma.$transaction(async (transaction) => {
        const [openDay, usedDate, opener] = await Promise.all([
          transaction.tradingDay.findFirst({
            where: { status: TradingDayStatus.OPEN },
            select: { id: true },
          }),
          transaction.tradingDay.findFirst({
            where: {
              locationId: null,
              businessDate,
            },
            select: { id: true },
          }),
          transaction.staffMember.findFirst({
            where: {
              id: input.openedByStaffMemberId,
              isActive: true,
            },
            select: { id: true },
          }),
        ]);

        if (openDay !== null) {
          throw new ConflictException('A business day is already open');
        }
        if (usedDate !== null) {
          throw new ConflictException(
            'A business day already exists for this business date',
          );
        }
        if (opener === null) {
          throw new BadRequestException(
            'openedByStaffMemberId must reference an active staff member',
          );
        }

        return transaction.tradingDay.create({
          data: {
            locationId: null,
            businessDate,
            status: TradingDayStatus.OPEN,
            dayType: input.dayType as DayType,
            openedAt: new Date(),
            openingFloatCents: input.openingFloatCents,
            openedByStaffMemberId: opener.id,
          },
          select: openTradingDaySelect,
        });
      });

      return this.toResponse(day);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('A business day is already open');
      }
      throw error;
    }
  }

  async getClosingSummary(): Promise<TradingDayClosingSummary> {
    const day = await this.findCurrentOpenDay();
    if (day === null) return this.noOpenDaySummary();

    const [cash, packaging, closingCount] = await Promise.all([
      this.calculateCash(day, this.prisma, 'OPEN', null),
      this.packagingReconciliation.getForTradingDay(day),
      this.prisma.stockCount.findFirst({
        where: {
          locationId: day.locationId,
          businessDate: day.businessDate,
          phase: StockCountPhase.CLOSE,
        },
        select: { id: true },
      }),
    ]);

    return {
      isOpen: true,
      businessDate: this.toDateOnly(day.businessDate),
      openingFloatCents: cents(day.openingFloatCents),
      cashSalesCents: cash.cashSalesCents,
      onlineSalesCents: cash.onlineSalesCents,
      grossSalesCents: cash.grossSalesCents,
      cashTipsCents: cash.tipsCents,
      cashInCents: cash.cashInCents,
      cashOutCents: cash.cashOutCents,
      cashExpensesCents: cash.cashExpensesCents,
      outstandingChangeCents: cash.outstandingChangeCents,
      expectedCashCents: cash.expectedCashCents,
      packaging,
      hasClosingStockCount: closingCount !== null,
    };
  }

  async getCashMovements(): Promise<CashMovementList> {
    const day = await this.findCurrentOpenDay();
    if (day === null) {
      return {
        businessDay: this.toResponse(null),
        movements: [],
      };
    }

    const movements = await this.prisma.cashMovement.findMany({
      where: { tradingDayId: day.id },
      orderBy: [{ recordedAt: 'desc' }, { id: 'desc' }],
    });

    return {
      businessDay: this.toResponse(day),
      movements: movements.map((movement) =>
        this.toCashMovement(movement),
      ),
    };
  }

  async recordCashMovement(
    input: CreateCashMovementDto,
  ): Promise<CashMovementResponse> {
    this.validateCashMovementInput(input);

    const replay = await this.prisma.cashMovement.findUnique({
      where: { id: input.clientGeneratedId },
    });
    if (replay !== null) return this.toCashMovement(replay);

    const initiallyOpenDay = await this.findCurrentOpenDay();
    if (initiallyOpenDay === null) {
      throw new ConflictException('No business day is open');
    }

    try {
      const movement = await this.prisma.$transaction(
        async (transaction) => {
          await this.lockTradingDay(transaction, initiallyOpenDay.id);

          const transactionReplay =
            await transaction.cashMovement.findUnique({
              where: { id: input.clientGeneratedId },
            });
          if (transactionReplay !== null) return transactionReplay;

          const [day, recorder] = await Promise.all([
            transaction.tradingDay.findFirst({
              where: {
                id: initiallyOpenDay.id,
                status: TradingDayStatus.OPEN,
              },
              select: { id: true },
            }),
            input.recordedByStaffMemberId
              ? transaction.staffMember.findFirst({
                  where: {
                    id: input.recordedByStaffMemberId,
                    isActive: true,
                  },
                  select: { id: true, displayName: true },
                })
              : Promise.resolve(null),
          ]);

          if (day === null) {
            throw new ConflictException('No business day is open');
          }
          if (input.recordedByStaffMemberId && recorder === null) {
            throw new BadRequestException(
              'recordedByStaffMemberId must reference an active staff member',
            );
          }

          return transaction.cashMovement.create({
            data: {
              id: input.clientGeneratedId,
              tradingDayId: day.id,
              kind: input.kind as CashMovementKind,
              amountCents: input.amountCents,
              description: input.description.trim(),
              category: input.category?.trim() || null,
              recordedByStaffMemberId: recorder?.id ?? null,
              recordedByNameSnapshot: recorder?.displayName ?? null,
            },
          });
        },
      );

      return this.toCashMovement(movement);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.cashMovement.findUnique({
          where: { id: input.clientGeneratedId },
        });
        if (existing !== null) return this.toCashMovement(existing);
      }
      throw error;
    }
  }

  async close(input: CloseBusinessDayDto): Promise<DayClosingResponse> {
    this.validateCloseInput(input);

    const replay = await this.prisma.dayClosing.findUnique({
      where: { id: input.clientGeneratedId },
      include: dayClosingInclude,
    });
    if (replay !== null) return this.toDayClosing(replay);

    const initiallyOpenDay = await this.findCurrentOpenDay();
    if (initiallyOpenDay === null) {
      throw new ConflictException('No business day is open');
    }

    const closing = await this.prisma.$transaction(async (transaction) => {
      const transactionReplay = await transaction.dayClosing.findUnique({
        where: { id: input.clientGeneratedId },
        include: dayClosingInclude,
      });
      if (transactionReplay !== null) return transactionReplay;

      await this.lockTradingDay(transaction, initiallyOpenDay.id);

      const [day, closer] = await Promise.all([
        transaction.tradingDay.findUnique({
          where: { id: initiallyOpenDay.id },
          select: {
            ...openTradingDaySelect,
            status: true,
          },
        }),
        transaction.staffMember.findFirst({
          where: {
            id: input.closedByStaffMemberId,
            isActive: true,
          },
          select: {
            id: true,
            displayName: true,
          },
        }),
      ]);

      if (closer === null) {
        throw new BadRequestException(
          'closedByStaffMemberId must reference an active staff member',
        );
      }
      if (day === null || day.status !== TradingDayStatus.OPEN) {
        const existing = await transaction.dayClosing.findUnique({
          where: { tradingDayId: initiallyOpenDay.id },
          include: dayClosingInclude,
        });
        if (existing !== null) return existing;
        throw new ConflictException('No business day is open');
      }

      const [cash, packaging] = await Promise.all([
        this.calculateCash(
          day,
          transaction,
          'CLOSED',
          input.actualCashCents,
        ),
        this.packagingReconciliation.getForTradingDay(day, transaction),
      ]);
      const closedAt = new Date();
      const transition = await transaction.tradingDay.updateMany({
        where: {
          id: day.id,
          status: TradingDayStatus.OPEN,
        },
        data: {
          status: TradingDayStatus.CLOSED,
          closedAt,
          closedByStaffMemberId: closer.id,
        },
      });

      if (transition.count === 0) {
        const existing = await transaction.dayClosing.findUnique({
          where: { tradingDayId: day.id },
          include: dayClosingInclude,
        });
        if (existing !== null) return existing;
        throw new ConflictException('Business day was already closed');
      }

      const cashCount = await transaction.cashCount.create({
        data: {
          tradingDayId: day.id,
          countedCents: input.actualCashCents,
          countedAt: closedAt,
          countedByStaffMemberId: closer.id,
        },
        select: { id: true },
      });

      return transaction.dayClosing.create({
        data: {
          id: input.clientGeneratedId,
          tradingDayId: day.id,
          cashCountId: cashCount.id,
          openingFloatCents: day.openingFloatCents,
          cashSalesCents: cash.cashSalesCents,
          onlineSalesCents: cash.onlineSalesCents,
          cashTipsCents: cash.tipsCents,
          cashInCents: cash.cashInCents,
          cashOutCents: cash.cashOutCents,
          cashExpensesCents: cash.cashExpensesCents,
          outstandingChangeCents: cash.outstandingChangeCents,
          expectedCashCents: cash.expectedCashCents,
          actualCashCents: input.actualCashCents,
          varianceCents: cash.varianceCents!,
          varianceReason: input.varianceReason ?? null,
          closedByStaffMemberId: closer.id,
          closedByNameSnapshot: closer.displayName,
          closedAt,
          lines: {
            create: packaging.map((line) => ({
              inventoryItemId: line.inventoryItemId,
              itemNameSnapshot: line.itemName,
              expectedQty: line.expectedQty,
              actualQty: line.actualQty,
              varianceQty: line.varianceQty,
            })),
          },
        },
        include: dayClosingInclude,
      });
    });

    return this.toDayClosing(closing);
  }

  toResponse(day: OpenTradingDay | null): CurrentOpenBusinessDay {
    if (day === null) {
      return {
        isOpen: false,
        businessDate: null,
        dayType: null,
        openingFloatCents: null,
        openedByDisplayName: null,
        openedAt: null,
      };
    }

    return {
      isOpen: true,
      businessDate: this.toDateOnly(day.businessDate),
      dayType: day.dayType as SharedDayType,
      openingFloatCents: cents(day.openingFloatCents),
      openedByDisplayName: day.openedByStaffMember.displayName,
      openedAt: day.openedAt.toISOString(),
    };
  }

  private async calculateCash(
    day: Pick<OpenTradingDay, 'id' | 'openingFloatCents'>,
    client: TradingDayClient,
    status: 'OPEN' | 'CLOSED',
    countedCents: number | null,
  ): Promise<CashReconciliation> {
    const [payments, sales, movements] = await Promise.all([
      client.salePayment.findMany({
        where: { sale: { tradingDayId: day.id } },
        select: { method: true, amountCents: true },
      }),
      client.sale.findMany({
        where: { tradingDayId: day.id },
        select: {
          cashTipCents: true,
          changeOwedCents: true,
          changeSettledAt: true,
        },
      }),
      client.cashMovement.findMany({
        where: { tradingDayId: day.id },
        select: { kind: true, amountCents: true },
      }),
    ]);

    const movementTotal = (kind: CashMovementKind) =>
      addMoney(
        ...movements
          .filter((movement) => movement.kind === kind)
          .map((movement) => cents(movement.amountCents)),
      );

    return calculateCashReconciliation({
      status,
      openingFloatCents: cents(day.openingFloatCents),
      payments: payments.map((payment) => ({
        method: payment.method,
        amountCents: cents(payment.amountCents),
      })),
      cashTipCents: sales.map((sale) => cents(sale.cashTipCents)),
      cashInCents: movementTotal(CashMovementKind.CASH_IN),
      cashOutCents: movementTotal(CashMovementKind.CASH_OUT),
      cashExpensesCents: movementTotal(CashMovementKind.EXPENSE),
      outstandingChangeCents: addMoney(
        ...sales
          .filter((sale) => sale.changeSettledAt === null)
          .map((sale) => cents(sale.changeOwedCents)),
      ),
      latestCountedCents:
        countedCents === null ? null : cents(countedCents),
    });
  }

  private noOpenDaySummary(): TradingDayClosingSummary {
    return {
      isOpen: false,
      businessDate: null,
      openingFloatCents: null,
      cashSalesCents: null,
      onlineSalesCents: null,
      grossSalesCents: null,
      cashTipsCents: null,
      cashInCents: null,
      cashOutCents: null,
      cashExpensesCents: null,
      outstandingChangeCents: null,
      expectedCashCents: null,
      packaging: [],
      hasClosingStockCount: false,
    };
  }

  private validateOpenInput(input: OpenBusinessDayDto): void {
    if (
      typeof input.businessDate !== 'string' ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.businessDate)
    ) {
      throw new BadRequestException(
        'businessDate must be a valid date in YYYY-MM-DD format',
      );
    }
    this.parseBusinessDate(input.businessDate);
    if (!Object.values(SharedDayType).includes(input.dayType)) {
      throw new BadRequestException('dayType must be NORMAL or PEAK');
    }
    if (
      !Number.isSafeInteger(input.openingFloatCents) ||
      input.openingFloatCents < 0
    ) {
      throw new BadRequestException(
        'openingFloatCents must be a non-negative integer',
      );
    }
    if (!input.openedByStaffMemberId) {
      throw new BadRequestException(
        'openedByStaffMemberId is required',
      );
    }
  }

  private validateCloseInput(input: CloseBusinessDayDto): void {
    if (!input.clientGeneratedId) {
      throw new BadRequestException('clientGeneratedId is required');
    }
    if (
      !Number.isSafeInteger(input.actualCashCents) ||
      input.actualCashCents < 0
    ) {
      throw new BadRequestException(
        'actualCashCents must be a non-negative integer',
      );
    }
    if (!input.closedByStaffMemberId) {
      throw new BadRequestException(
        'closedByStaffMemberId is required',
      );
    }
  }

  private validateCashMovementInput(input: CreateCashMovementDto): void {
    if (!input.clientGeneratedId) {
      throw new BadRequestException('clientGeneratedId is required');
    }
    if (!Object.values(SharedCashMovementKind).includes(input.kind)) {
      throw new BadRequestException(
        'kind must be CASH_IN, CASH_OUT or EXPENSE',
      );
    }
    if (
      !Number.isSafeInteger(input.amountCents) ||
      input.amountCents < 1 ||
      input.amountCents > 2_147_483_647
    ) {
      throw new BadRequestException(
        'amountCents must be a positive integer no greater than 2147483647',
      );
    }
    if (
      typeof input.description !== 'string' ||
      input.description.trim().length === 0
    ) {
      throw new BadRequestException('description must not be blank');
    }
    if (
      input.kind !== SharedCashMovementKind.EXPENSE &&
      input.category !== undefined &&
      input.category !== null
    ) {
      throw new BadRequestException(
        'category is only allowed for EXPENSE',
      );
    }
  }

  private async lockTradingDay(
    transaction: Prisma.TransactionClient,
    tradingDayId: string,
  ): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "trading_days" WHERE "id" = ${tradingDayId}::uuid FOR UPDATE`,
    );
  }

  private parseBusinessDate(value: string): Date {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (
      Number.isNaN(date.getTime()) ||
      this.toDateOnly(date) !== value
    ) {
      throw new BadRequestException('businessDate must be a valid date');
    }
    return date;
  }

  private toDateOnly(value: Date): string {
    return value.toISOString().slice(0, 10);
  }

  private toDayClosing(record: DayClosingRecord): DayClosingResponse {
    return {
      id: record.id,
      tradingDayId: record.tradingDayId,
      cashCountId: record.cashCountId,
      openingFloatCents: cents(record.openingFloatCents),
      cashSalesCents: cents(record.cashSalesCents),
      onlineSalesCents: cents(record.onlineSalesCents),
      cashTipsCents: cents(record.cashTipsCents),
      cashInCents: cents(record.cashInCents),
      cashOutCents: cents(record.cashOutCents),
      cashExpensesCents: cents(record.cashExpensesCents),
      outstandingChangeCents: cents(record.outstandingChangeCents),
      expectedCashCents: cents(record.expectedCashCents),
      actualCashCents: cents(record.actualCashCents),
      varianceCents: cents(record.varianceCents),
      varianceReason: record.varianceReason,
      closedByStaffMemberId: record.closedByStaffMemberId,
      closedByNameSnapshot: record.closedByNameSnapshot,
      closedAt: record.closedAt.toISOString(),
      lines: record.lines.map((line) => ({
        id: line.id,
        dayClosingId: line.dayClosingId,
        inventoryItemId: line.inventoryItemId,
        itemNameSnapshot: line.itemNameSnapshot,
        expectedQty: line.expectedQty,
        actualQty: line.actualQty,
        varianceQty: line.varianceQty,
      })),
    };
  }

  private toCashMovement(
    record: CashMovementRecord,
  ): CashMovementResponse {
    return {
      id: record.id,
      tradingDayId: record.tradingDayId,
      kind: record.kind as SharedCashMovementKind,
      amountCents: cents(record.amountCents),
      description: record.description,
      category: record.category,
      recordedByStaffMemberId: record.recordedByStaffMemberId,
      recordedByNameSnapshot: record.recordedByNameSnapshot,
      recordedAt: record.recordedAt.toISOString(),
    };
  }
}
