import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  AddOrderLineDto,
  CompleteOrderDto,
  CreateOrderDto,
  UpdateOrderDto,
  UpdateOrderLineDto,
  VoidOrderDto,
} from './orders.dto';
import { OrderRecord, OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  create(@Body() input: CreateOrderDto): Promise<OrderRecord> {
    return this.ordersService.create(input);
  }

  @Get('parked')
  listParked(): Promise<OrderRecord[]> {
    return this.ordersService.listParked();
  }

  @Get(':clientGeneratedId')
  get(
    @Param('clientGeneratedId', new ParseUUIDPipe()) id: string,
  ): Promise<OrderRecord> {
    return this.ordersService.get(id);
  }

  @Patch(':clientGeneratedId')
  update(
    @Param('clientGeneratedId', new ParseUUIDPipe()) id: string,
    @Body() input: UpdateOrderDto,
  ): Promise<OrderRecord> {
    return this.ordersService.update(id, input);
  }

  @Post(':clientGeneratedId/lines')
  addLine(
    @Param('clientGeneratedId', new ParseUUIDPipe()) id: string,
    @Body() input: AddOrderLineDto,
  ): Promise<OrderRecord> {
    return this.ordersService.addLine(id, input);
  }

  @Patch(':clientGeneratedId/lines/:lineId')
  updateLine(
    @Param('clientGeneratedId', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
    @Body() input: UpdateOrderLineDto,
  ): Promise<OrderRecord> {
    return this.ordersService.updateLine(id, lineId, input);
  }

  @Post(':clientGeneratedId/lines/:lineId/increment')
  incrementLine(
    @Param('clientGeneratedId', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
  ): Promise<OrderRecord> {
    return this.ordersService.incrementLine(id, lineId);
  }

  @Post(':clientGeneratedId/lines/:lineId/decrement')
  decrementLine(
    @Param('clientGeneratedId', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
  ): Promise<OrderRecord | null> {
    return this.ordersService.decrementLine(id, lineId);
  }

  @Delete(':clientGeneratedId/lines/:lineId')
  removeLine(
    @Param('clientGeneratedId', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
  ): Promise<OrderRecord | null> {
    return this.ordersService.removeLine(id, lineId);
  }

  @Post(':clientGeneratedId/complete')
  complete(
    @Param('clientGeneratedId', new ParseUUIDPipe()) id: string,
    @Body() input: CompleteOrderDto,
  ): Promise<OrderRecord> {
    return this.ordersService.complete(id, input);
  }

  @Post(':clientGeneratedId/void')
  void(
    @Param('clientGeneratedId', new ParseUUIDPipe()) id: string,
    @Body() input: VoidOrderDto,
  ): Promise<OrderRecord> {
    return this.ordersService.void(id, input);
  }

  @Post(':clientGeneratedId/change-settlement')
  settleChange(
    @Param('clientGeneratedId', new ParseUUIDPipe()) id: string,
  ): Promise<OrderRecord> {
    return this.ordersService.settleChange(id);
  }
}
