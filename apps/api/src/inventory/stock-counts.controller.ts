import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import type {
  CountSheet,
  InventoryStaffOption,
  SubmittedStockCount,
} from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { SubmitStockCountDto } from './inventory.dto';
import { StockCountsService } from './stock-counts.service';

@Controller('inventory/counts')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF)
export class StockCountsController {
  constructor(private readonly stockCountsService: StockCountsService) {}

  @Get('opening-sheet')
  openingSheet(): Promise<CountSheet> {
    return this.stockCountsService.openingSheet();
  }

  @Get('closing-sheet')
  closingSheet(): Promise<CountSheet> {
    return this.stockCountsService.closingSheet();
  }

  @Get('staff')
  listActiveStaff(): Promise<InventoryStaffOption[]> {
    return this.stockCountsService.listActiveStaff();
  }

  @Post()
  submit(
    @Body() input: SubmitStockCountDto,
  ): Promise<SubmittedStockCount> {
    return this.stockCountsService.submit(input);
  }
}
