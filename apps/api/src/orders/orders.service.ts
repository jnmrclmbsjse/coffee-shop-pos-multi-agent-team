import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  LineDiscountKind,
  LinePreference,
  OrderStatus,
  PaymentMethod,
  Prisma,
  SaleKind,
  ServiceType,
  TradingDayStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SalesService } from '../sales/sales.service';
import {
  AddOrderLineDto,
  CompleteOrderDto,
  CreateOrderDto,
  UpdateOrderDto,
  UpdateOrderLineDto,
  VoidOrderDto,
} from './orders.dto';
import {
  FREE_UPSIZE_UNIT_CENTS,
  STATUTORY_DISCOUNT_PERCENT,
} from './orders.constants';

export const NO_OPEN_DAY_MESSAGE = 'No business day is open';
export const ORDER_FROZEN_MESSAGE = 'Completed orders cannot be changed';

const orderInclude = {
  lines: { orderBy: [{ id: 'asc' as const }] },
  payments: { orderBy: [{ method: 'asc' as const }] },
} satisfies Prisma.SaleInclude;

export type OrderRecord = Prisma.SaleGetPayload<{
  include: typeof orderInclude;
}>;

type MutableLine = Pick<
  OrderRecord['lines'][number],
  | 'quantity'
  | 'unitPriceCents'
  | 'discountKind'
  | 'freeUpsizeCount'
  | 'freeUpsizeEligible'
>;

export interface LineAmounts {
  lineGrossCents: number;
  freeUpsizeCents: number;
  discountCents: number;
  lineTotalCents: number;
}

export function calculateLineAmounts(line: MutableLine): LineAmounts {
  if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) {
    throw new BadRequestException('quantity must be a positive integer');
  }
  if (
    !Number.isSafeInteger(line.freeUpsizeCount) ||
    line.freeUpsizeCount < 0 ||
    line.freeUpsizeCount > line.quantity
  ) {
    throw new BadRequestException(
      'freeUpsizeCount must be between zero and quantity',
    );
  }
  if (!line.freeUpsizeEligible && line.freeUpsizeCount > 0) {
    throw new BadRequestException(
      'This product is not eligible for a free upsize',
    );
  }

  const lineGrossCents = line.unitPriceCents * line.quantity;
  const freeUpsizeCents =
    line.freeUpsizeCount * FREE_UPSIZE_UNIT_CENTS;
  if (!Number.isSafeInteger(lineGrossCents)) {
    throw new BadRequestException('Line amount exceeds the supported range');
  }
  if (freeUpsizeCents > lineGrossCents) {
    throw new BadRequestException(
      'Free upsize value cannot exceed the line gross amount',
    );
  }

  const discountBaseCents = lineGrossCents - freeUpsizeCents;
  const discountCents =
    line.discountKind === LineDiscountKind.NONE
      ? 0
      : Math.floor(
          (discountBaseCents * STATUTORY_DISCOUNT_PERCENT + 50) / 100,
        );

  return {
    lineGrossCents,
    freeUpsizeCents,
    discountCents,
    lineTotalCents:
      lineGrossCents - freeUpsizeCents - discountCents,
  };
}

export function normalizePreferences(
  preferences: readonly LinePreference[],
): LinePreference[] {
  const declarationOrder = Object.values(LinePreference);
  return declarationOrder.filter((preference) =>
    preferences.includes(preference),
  );
}

export function isPlainMergeableLine(
  line: Pick<
    OrderRecord['lines'][number],
    | 'discountKind'
    | 'preferences'
    | 'preferenceNote'
    | 'freeUpsizeCount'
  >,
): boolean {
  return (
    line.discountKind === LineDiscountKind.NONE &&
    line.preferences.length === 0 &&
    line.preferenceNote === null &&
    line.freeUpsizeCount === 0
  );
}

export function validateTender(
  totalCents: number,
  input: CompleteOrderDto,
): { cashReceivedCents: number | null } {
  if (!Array.isArray(input.payments) || input.payments.length === 0) {
    throw new BadRequestException('At least one payment is required');
  }
  const methods = input.payments.map((payment) => payment.method);
  if (new Set(methods).size !== methods.length) {
    throw new BadRequestException('Each payment method may appear only once');
  }
  if (
    input.payments.some(
      (payment) =>
        !Number.isSafeInteger(payment.amountCents) ||
        payment.amountCents < 0,
    )
  ) {
    throw new BadRequestException(
      'Payment portions must be non-negative integers',
    );
  }
  const paid = input.payments.reduce(
    (sum, payment) => sum + payment.amountCents,
    0,
  );
  if (paid !== totalCents) {
    throw new BadRequestException('Payment total must equal the amount due');
  }
  if (
    !Number.isSafeInteger(input.cashTipCents ?? 0) ||
    (input.cashTipCents ?? 0) < 0
  ) {
    throw new BadRequestException(
      'cashTipCents must be a non-negative integer',
    );
  }

  const cashTender = input.payments
    .filter((payment) => payment.method === PaymentMethod.CASH)
    .reduce((sum, payment) => sum + payment.amountCents, 0);
  if (cashTender === 0) {
    if (
      input.cashReceivedCents !== undefined &&
      input.cashReceivedCents !== null
    ) {
      throw new BadRequestException(
        'Online-only payment cannot record cash received',
      );
    }
    if ((input.changeOwedCents ?? 0) !== 0) {
      throw new BadRequestException(
        'Online-only payment cannot record change owed',
      );
    }
    return { cashReceivedCents: null };
  }

  const cashReceivedCents = input.cashReceivedCents ?? cashTender;
  if (cashReceivedCents < cashTender) {
    throw new BadRequestException(
      'cashReceivedCents cannot be less than the cash payment',
    );
  }
  const changeDueCents = cashReceivedCents - cashTender;
  if ((input.changeOwedCents ?? 0) > changeDueCents) {
    throw new BadRequestException(
      'changeOwedCents cannot exceed the calculated change due',
    );
  }
  return { cashReceivedCents };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly salesService: SalesService,
  ) {}

  async create(input: CreateOrderDto): Promise<OrderRecord> {
    const replay = await this.findByClientGeneratedId(input.clientGeneratedId);
    if (replay !== null) return replay;

    try {
      return await this.prisma.$transaction(async (transaction) => {
        const transactionReplay = await this.findByClientGeneratedId(
          input.clientGeneratedId,
          transaction,
        );
        if (transactionReplay !== null) return transactionReplay;

        const day = await transaction.tradingDay.findFirst({
          where: { status: TradingDayStatus.OPEN },
          orderBy: { openedAt: 'desc' },
          select: { id: true, locationId: true },
        });
        if (day === null) throw new ConflictException(NO_OPEN_DAY_MESSAGE);

        await this.lockTradingDay(transaction, day.id);
        const stillOpen = await transaction.tradingDay.findFirst({
          where: { id: day.id, status: TradingDayStatus.OPEN },
          select: { id: true },
        });
        if (stillOpen === null) {
          throw new ConflictException(NO_OPEN_DAY_MESSAGE);
        }

        const lockedReplay = await this.findByClientGeneratedId(
          input.clientGeneratedId,
          transaction,
        );
        if (lockedReplay !== null) return lockedReplay;

        const [lastOrder, variant, cashier] = await Promise.all([
          transaction.sale.findFirst({
            where: { tradingDayId: day.id },
            orderBy: { dayOrderNumber: 'desc' },
            select: { dayOrderNumber: true },
          }),
          this.requireSellableVariant(transaction, input.productVariantId),
          this.salesService.activeCashier(input.deviceId, transaction),
        ]);
        const line = this.lineCreateData(input, variant);
        const amounts = calculateLineAmounts(line);

        return transaction.sale.create({
          data: {
            clientGeneratedId: input.clientGeneratedId,
            locationId: day.locationId,
            tradingDayId: day.id,
            cashierStaffMemberId: cashier?.id ?? null,
            cashierNameSnapshot: cashier?.displayName ?? null,
            kind: SaleKind.PURCHASE,
            dayOrderNumber: (lastOrder?.dayOrderNumber ?? 0) + 1,
            status: OrderStatus.PARKED,
            customerName: input.customerName ?? null,
            serviceType: input.serviceType ?? ServiceType.DINE_IN,
            subtotalCents: amounts.lineGrossCents,
            discountCents: amounts.discountCents,
            freeUpsizeCents: amounts.freeUpsizeCents,
            taxCents: 0,
            totalCents: amounts.lineTotalCents,
            lines: { create: { ...line, ...amounts } },
          },
          include: orderInclude,
        });
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const replay = await this.findByClientGeneratedId(
          input.clientGeneratedId,
        );
        if (replay !== null) return replay;
      }
      throw error;
    }
  }

  async listParked(): Promise<OrderRecord[]> {
    const day = await this.requireOpenDay(this.prisma);
    return this.prisma.sale.findMany({
      where: {
        tradingDayId: day.id,
        kind: SaleKind.PURCHASE,
        status: OrderStatus.PARKED,
      },
      orderBy: [{ dayOrderNumber: 'asc' }],
      include: orderInclude,
    });
  }

  async get(clientGeneratedId: string): Promise<OrderRecord> {
    const order = await this.findByClientGeneratedId(clientGeneratedId);
    if (order === null || order.kind !== SaleKind.PURCHASE) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  async update(
    clientGeneratedId: string,
    input: UpdateOrderDto,
  ): Promise<OrderRecord> {
    return this.mutateParked(clientGeneratedId, async (transaction, order) => {
      await transaction.sale.updateMany({
        where: { id: order.id, status: OrderStatus.PARKED },
        data: {
          ...(input.customerName !== undefined
            ? { customerName: input.customerName }
            : {}),
          ...(input.serviceType !== undefined
            ? { serviceType: input.serviceType }
            : {}),
        },
      });
    });
  }

  async addLine(
    clientGeneratedId: string,
    input: AddOrderLineDto,
  ): Promise<OrderRecord> {
    return this.mutateParked(clientGeneratedId, async (transaction, order) => {
      const variant = await this.requireSellableVariant(
        transaction,
        input.productVariantId,
      );
      const incoming = this.lineCreateData(input, variant);
      const mergeLine =
        isPlainMergeableLine(incoming)
          ? order.lines.find(
              (line) =>
                line.productVariantId === input.productVariantId &&
                isPlainMergeableLine(line),
            )
          : undefined;

      if (mergeLine) {
        const quantity = mergeLine.quantity + (input.quantity ?? 1);
        await transaction.saleLine.update({
          where: { id: mergeLine.id },
          data: { quantity, ...calculateLineAmounts({ ...mergeLine, quantity }) },
        });
      } else {
        await transaction.saleLine.create({
          data: {
            saleId: order.id,
            ...incoming,
            ...calculateLineAmounts(incoming),
          },
        });
      }
    });
  }

  async updateLine(
    clientGeneratedId: string,
    lineId: string,
    input: UpdateOrderLineDto,
  ): Promise<OrderRecord> {
    return this.mutateParked(clientGeneratedId, async (transaction, order) => {
      const current = this.requireOwnedLine(order, lineId);
      const next = {
        ...current,
        ...(input.quantity !== undefined ? { quantity: input.quantity } : {}),
        ...(input.discountKind !== undefined
          ? { discountKind: input.discountKind }
          : {}),
        ...(input.preferences !== undefined
          ? { preferences: normalizePreferences(input.preferences) }
          : {}),
        ...(input.preferenceNote !== undefined
          ? { preferenceNote: input.preferenceNote }
          : {}),
        ...(input.freeUpsizeCount !== undefined
          ? { freeUpsizeCount: input.freeUpsizeCount }
          : {}),
      };
      await transaction.saleLine.update({
        where: { id: current.id },
        data: {
          quantity: next.quantity,
          discountKind: next.discountKind,
          preferences: next.preferences,
          preferenceNote: next.preferenceNote,
          freeUpsizeCount: next.freeUpsizeCount,
          ...calculateLineAmounts(next),
        },
      });
    });
  }

  async incrementLine(
    clientGeneratedId: string,
    lineId: string,
  ): Promise<OrderRecord> {
    return this.mutateParked(clientGeneratedId, async (transaction, order) => {
      const line = this.requireOwnedLine(order, lineId);
      const quantity = line.quantity + 1;
      await transaction.saleLine.update({
        where: { id: line.id },
        data: { quantity, ...calculateLineAmounts({ ...line, quantity }) },
      });
    });
  }

  async decrementLine(
    clientGeneratedId: string,
    lineId: string,
  ): Promise<OrderRecord | null> {
    return this.mutateParkedWithDiscard(
      clientGeneratedId,
      async (transaction, order) => {
        const line = this.requireOwnedLine(order, lineId);
        const quantity = line.quantity - 1;
        if (quantity === 0) {
          await transaction.saleLine.delete({ where: { id: line.id } });
          return;
        }
        await transaction.saleLine.update({
          where: { id: line.id },
          data: { quantity, ...calculateLineAmounts({ ...line, quantity }) },
        });
      },
    );
  }

  async removeLine(
    clientGeneratedId: string,
    lineId: string,
  ): Promise<OrderRecord | null> {
    return this.mutateParkedWithDiscard(
      clientGeneratedId,
      async (transaction, order) => {
        this.requireOwnedLine(order, lineId);
        await transaction.saleLine.delete({ where: { id: lineId } });
      },
    );
  }

  async complete(
    clientGeneratedId: string,
    input: CompleteOrderDto,
  ): Promise<OrderRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const order = await this.lockAndRequireOrder(
        clientGeneratedId,
        transaction,
      );
      if (order.status === OrderStatus.COMPLETED) return order;
      if (order.lines.length === 0) {
        throw new BadRequestException('An empty order cannot be completed');
      }
      await this.requireOrderDayOpen(transaction, order.tradingDayId);

      const settlement = validateTender(order.totalCents, input);
      const updated = await transaction.sale.updateMany({
        where: { id: order.id, status: OrderStatus.PARKED },
        data: {
          status: OrderStatus.COMPLETED,
          cashTipCents: input.cashTipCents ?? 0,
          cashReceivedCents: settlement.cashReceivedCents,
          changeOwedCents: input.changeOwedCents ?? 0,
          completedAt: new Date(),
        },
      });
      if (updated.count === 0) {
        return this.requireOrder(clientGeneratedId, transaction);
      }
      await transaction.salePayment.createMany({
        data: input.payments.map((payment) => ({
          saleId: order.id,
          method: payment.method,
          amountCents: payment.amountCents,
        })),
      });
      return this.requireOrder(clientGeneratedId, transaction);
    });
  }

  async void(
    originalClientGeneratedId: string,
    input: VoidOrderDto,
  ): Promise<OrderRecord> {
    const replay = await this.findByClientGeneratedId(input.clientGeneratedId);
    if (replay !== null) return replay;

    return this.prisma.$transaction(async (transaction) => {
      const transactionReplay = await this.findByClientGeneratedId(
        input.clientGeneratedId,
        transaction,
      );
      if (transactionReplay !== null) return transactionReplay;

      const original = await this.lockAndRequireOrder(
        originalClientGeneratedId,
        transaction,
      );
      const lockedReplay = await this.findByClientGeneratedId(
        input.clientGeneratedId,
        transaction,
      );
      if (lockedReplay !== null) return lockedReplay;
      if (original.status !== OrderStatus.COMPLETED) {
        throw new ConflictException('Only a completed order can be voided');
      }
      const existingVoid = await transaction.sale.findFirst({
        where: { kind: SaleKind.VOID, correctsSaleId: original.id },
        select: { id: true },
      });
      if (existingVoid !== null) {
        throw new ConflictException('Order has already been voided');
      }

      const day = await this.requireOpenDay(transaction);
      await this.lockTradingDay(transaction, day.id);
      const stillOpen = await transaction.tradingDay.findFirst({
        where: { id: day.id, status: TradingDayStatus.OPEN },
        select: { id: true },
      });
      if (stillOpen === null) throw new ConflictException(NO_OPEN_DAY_MESSAGE);

      const [lastOrder, cashier] = await Promise.all([
        transaction.sale.findFirst({
          where: { tradingDayId: day.id },
          orderBy: { dayOrderNumber: 'desc' },
          select: { dayOrderNumber: true },
        }),
        this.salesService.activeCashier(input.deviceId, transaction),
      ]);

      return transaction.sale.create({
        data: {
          clientGeneratedId: input.clientGeneratedId,
          locationId: day.locationId,
          tradingDayId: day.id,
          cashierStaffMemberId: cashier?.id ?? null,
          cashierNameSnapshot: cashier?.displayName ?? null,
          kind: SaleKind.VOID,
          correctsSaleId: original.id,
          dayOrderNumber: (lastOrder?.dayOrderNumber ?? 0) + 1,
          status: OrderStatus.COMPLETED,
          customerName: original.customerName,
          serviceType: original.serviceType,
          subtotalCents: -original.subtotalCents,
          discountCents: -original.discountCents,
          freeUpsizeCents: -original.freeUpsizeCents,
          taxCents: -original.taxCents,
          totalCents: -original.totalCents,
          cashTipCents: 0,
          voidReason: input.voidReason.trim(),
          lines: {
            create: original.lines.map((line) => ({
              productVariantId: line.productVariantId,
              quantity: -line.quantity,
              unitPriceCents: line.unitPriceCents,
              lineGrossCents: -line.lineGrossCents,
              discountKind: line.discountKind,
              discountCents: -line.discountCents,
              preferences: line.preferences,
              preferenceNote: line.preferenceNote,
              freeUpsizeCount: -line.freeUpsizeCount,
              freeUpsizeCents: -line.freeUpsizeCents,
              freeUpsizeEligible: line.freeUpsizeEligible,
              lineTotalCents: -line.lineTotalCents,
              productNameSnapshot: line.productNameSnapshot,
              variantNameSnapshot: line.variantNameSnapshot,
            })),
          },
          payments: {
            create: original.payments.map((payment) => ({
              method: payment.method,
              amountCents: -payment.amountCents,
            })),
          },
        },
        include: orderInclude,
      });
    });
  }

  async settleChange(clientGeneratedId: string): Promise<OrderRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const order = await this.lockAndRequireOrder(
        clientGeneratedId,
        transaction,
      );
      if (order.status !== OrderStatus.COMPLETED) {
        throw new ConflictException(
          'Only a completed order can settle outstanding change',
        );
      }
      if (order.changeOwedCents <= 0) {
        throw new ConflictException('Order has no change owed');
      }
      if (order.changeSettledAt !== null) return order;

      await transaction.sale.updateMany({
        where: {
          id: order.id,
          status: OrderStatus.COMPLETED,
          changeOwedCents: { gt: 0 },
          changeSettledAt: null,
        },
        data: { changeSettledAt: new Date() },
      });
      return this.requireOrder(clientGeneratedId, transaction);
    });
  }

  private async mutateParked(
    clientGeneratedId: string,
    mutation: (
      transaction: Prisma.TransactionClient,
      order: OrderRecord,
    ) => Promise<void>,
  ): Promise<OrderRecord> {
    return this.prisma.$transaction(async (transaction) => {
      const order = await this.lockAndRequireOrder(
        clientGeneratedId,
        transaction,
      );
      if (order.status !== OrderStatus.PARKED) {
        throw new ConflictException(ORDER_FROZEN_MESSAGE);
      }
      await this.requireOrderDayOpen(transaction, order.tradingDayId);
      await mutation(transaction, order);
      await this.recalculateOrder(transaction, order.id);
      return this.requireOrder(clientGeneratedId, transaction);
    });
  }

  private async mutateParkedWithDiscard(
    clientGeneratedId: string,
    mutation: (
      transaction: Prisma.TransactionClient,
      order: OrderRecord,
    ) => Promise<void>,
  ): Promise<OrderRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const order = await this.lockAndRequireOrder(
        clientGeneratedId,
        transaction,
      );
      if (order.status !== OrderStatus.PARKED) {
        throw new ConflictException(ORDER_FROZEN_MESSAGE);
      }
      await this.requireOrderDayOpen(transaction, order.tradingDayId);
      await mutation(transaction, order);

      const remainingLines = await transaction.saleLine.count({
        where: { saleId: order.id },
      });
      if (remainingLines === 0) {
        await transaction.sale.delete({ where: { id: order.id } });
        return null;
      }

      await this.recalculateOrder(transaction, order.id);
      return this.requireOrder(clientGeneratedId, transaction);
    });
  }

  private async recalculateOrder(
    transaction: Prisma.TransactionClient,
    saleId: string,
  ): Promise<void> {
    const lines = await transaction.saleLine.findMany({ where: { saleId } });
    const subtotalCents = lines.reduce(
      (total, line) => total + line.lineGrossCents,
      0,
    );
    const discountCents = lines.reduce(
      (total, line) => total + line.discountCents,
      0,
    );
    const freeUpsizeCents = lines.reduce(
      (total, line) => total + line.freeUpsizeCents,
      0,
    );
    await transaction.sale.updateMany({
      where: { id: saleId, status: OrderStatus.PARKED },
      data: {
        subtotalCents,
        discountCents,
        freeUpsizeCents,
        taxCents: 0,
        totalCents: subtotalCents - freeUpsizeCents - discountCents,
      },
    });
  }

  private lineCreateData(
    input: AddOrderLineDto,
    variant: Awaited<ReturnType<OrdersService['requireSellableVariant']>>,
  ) {
    return {
      productVariantId: variant.id,
      quantity: input.quantity ?? 1,
      unitPriceCents: variant.priceCents,
      discountKind: input.discountKind ?? LineDiscountKind.NONE,
      preferences: normalizePreferences(input.preferences ?? []),
      preferenceNote: input.preferenceNote ?? null,
      freeUpsizeCount: input.freeUpsizeCount ?? 0,
      freeUpsizeEligible: variant.product.category.freeUpsizeEligible,
      productNameSnapshot: variant.product.name,
      variantNameSnapshot: variant.name,
    };
  }

  private async requireSellableVariant(
    transaction: Prisma.TransactionClient,
    productVariantId: string,
  ) {
    const variant = await transaction.productVariant.findFirst({
      where: {
        id: productVariantId,
        active: true,
        product: { active: true, available: true },
      },
      select: {
        id: true,
        name: true,
        priceCents: true,
        product: {
          select: {
            name: true,
            category: { select: { freeUpsizeEligible: true } },
          },
        },
      },
    });
    if (variant === null) {
      throw new BadRequestException('Product size is not available for sale');
    }
    return variant;
  }

  private requireOwnedLine(order: OrderRecord, lineId: string) {
    const line = order.lines.find((candidate) => candidate.id === lineId);
    if (!line) throw new NotFoundException('Order line not found');
    return line;
  }

  private async requireOpenDay(client: Prisma.TransactionClient | PrismaService) {
    const day = await client.tradingDay.findFirst({
      where: { status: TradingDayStatus.OPEN },
      orderBy: { openedAt: 'desc' },
      select: { id: true, locationId: true },
    });
    if (day === null) throw new ConflictException(NO_OPEN_DAY_MESSAGE);
    return day;
  }

  private async requireOrderDayOpen(
    transaction: Prisma.TransactionClient,
    tradingDayId: string,
  ): Promise<void> {
    const day = await transaction.tradingDay.findFirst({
      where: { id: tradingDayId, status: TradingDayStatus.OPEN },
      select: { id: true },
    });
    if (day === null) throw new ConflictException(NO_OPEN_DAY_MESSAGE);
  }

  private async requireOrder(
    clientGeneratedId: string,
    client: Prisma.TransactionClient | PrismaService,
  ): Promise<OrderRecord> {
    const order = await this.findByClientGeneratedId(clientGeneratedId, client);
    if (order === null || order.kind !== SaleKind.PURCHASE) {
      throw new NotFoundException('Order not found');
    }
    return order;
  }

  private async lockAndRequireOrder(
    clientGeneratedId: string,
    transaction: Prisma.TransactionClient,
  ): Promise<OrderRecord> {
    const identity = await transaction.sale.findUnique({
      where: { clientGeneratedId },
      select: { id: true, kind: true },
    });
    if (identity === null || identity.kind !== SaleKind.PURCHASE) {
      throw new NotFoundException('Order not found');
    }
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "sales" WHERE "id" = ${identity.id}::uuid FOR UPDATE`,
    );
    return this.requireOrder(clientGeneratedId, transaction);
  }

  private findByClientGeneratedId(
    clientGeneratedId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<OrderRecord | null> {
    return client.sale.findUnique({
      where: { clientGeneratedId },
      include: orderInclude,
    });
  }

  private async lockTradingDay(
    transaction: Prisma.TransactionClient,
    tradingDayId: string,
  ): Promise<void> {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "trading_days" WHERE "id" = ${tradingDayId}::uuid FOR UPDATE`,
    );
  }
}
