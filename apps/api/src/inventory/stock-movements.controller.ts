import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import type {
  StockMovementList,
  StockMovementListItem,
} from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CreateStockMovementDto } from './inventory.dto';
import { StockMovementsService } from './stock-movements.service';

@Controller('inventory/movements')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF)
export class StockMovementsController {
  constructor(
    private readonly stockMovementsService: StockMovementsService,
  ) {}

  @Get()
  list(): Promise<StockMovementList> {
    return this.stockMovementsService.list();
  }

  @Post()
  create(
    @Body() input: CreateStockMovementDto,
  ): Promise<StockMovementListItem> {
    return this.stockMovementsService.create(input);
  }
}
