import { Controller, Get, UseGuards } from '@nestjs/common';
import { Role } from '@coffee-shop/shared';
import type { RestockStatusResult } from '@coffee-shop/shared';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RestockService } from './restock.service';

@Controller('inventory/restock')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN, Role.STAFF)
export class RestockController {
  constructor(private readonly restockService: RestockService) {}

  @Get()
  getStatus(): Promise<RestockStatusResult> {
    return this.restockService.getStatus();
  }
}
