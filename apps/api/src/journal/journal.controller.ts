import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  type JournalDeposit,
  type JournalLedgerBalance,
  type JournalMissingDay,
  type JournalSuggestionRate,
  type JournalWithdrawal,
  Role,
} from '@coffee-shop/shared';
import type { AuthenticatedRequest } from '../auth/auth.types';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import {
  BulkCreateJournalDepositsDto,
  CreateJournalDepositDto,
  CreateJournalLedgerDto,
  CreateJournalWithdrawalDto,
  UpdateJournalDepositDto,
  UpdateJournalLedgerDto,
  UpdateJournalSuggestionRateDto,
  UpdateJournalWithdrawalDto,
} from './journal.dto';
import {
  type JournalLedgerDetail,
  JournalService,
} from './journal.service';

@Controller('journal')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
export class JournalController {
  constructor(private readonly journalService: JournalService) {}

  @Get('ledgers')
  listLedgers(): Promise<JournalLedgerBalance[]> {
    return this.journalService.listLedgers();
  }

  @Post('ledgers')
  createLedger(
    @Body() input: CreateJournalLedgerDto,
  ): Promise<JournalLedgerBalance> {
    return this.journalService.createLedger(input);
  }

  @Get('ledgers/:id')
  getLedger(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<JournalLedgerDetail> {
    return this.journalService.getLedger(id);
  }

  @Patch('ledgers/:id')
  updateLedger(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateJournalLedgerDto,
  ): Promise<JournalLedgerBalance> {
    return this.journalService.updateLedger(id, input);
  }

  @Get('ledgers/:id/rate')
  getRate(
    @Param('id', ParseUUIDPipe) ledgerId: string,
  ): Promise<JournalSuggestionRate | null> {
    return this.journalService.getRate(ledgerId);
  }

  @Put('ledgers/:id/rate')
  updateRate(
    @Param('id', ParseUUIDPipe) ledgerId: string,
    @Body() input: UpdateJournalSuggestionRateDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<JournalSuggestionRate> {
    return this.journalService.updateRate(ledgerId, input, request.user!.id);
  }

  @Get('ledgers/:id/missing-days')
  getMissingDays(
    @Param('id', ParseUUIDPipe) ledgerId: string,
  ): Promise<JournalMissingDay[]> {
    return this.journalService.getMissingDays(ledgerId);
  }

  @Post('ledgers/:id/deposits/bulk')
  createDepositsBulk(
    @Param('id', ParseUUIDPipe) ledgerId: string,
    @Body() input: BulkCreateJournalDepositsDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<JournalDeposit[]> {
    return this.journalService.createDepositsBulk(
      ledgerId,
      input,
      request.user!.id,
    );
  }

  @Post('ledgers/:id/deposits')
  createDeposit(
    @Param('id', ParseUUIDPipe) ledgerId: string,
    @Body() input: CreateJournalDepositDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<JournalDeposit> {
    return this.journalService.createDeposit(
      ledgerId,
      input,
      request.user!.id,
    );
  }

  @Patch('deposits/:id')
  updateDeposit(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateJournalDepositDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<JournalDeposit> {
    return this.journalService.updateDeposit(id, input, request.user!.id);
  }

  @Delete('deposits/:id')
  removeDeposit(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.journalService.removeDeposit(id);
  }

  @Post('ledgers/:id/withdrawals')
  createWithdrawal(
    @Param('id', ParseUUIDPipe) ledgerId: string,
    @Body() input: CreateJournalWithdrawalDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<JournalWithdrawal> {
    return this.journalService.createWithdrawal(
      ledgerId,
      input,
      request.user!.id,
    );
  }

  @Patch('withdrawals/:id')
  updateWithdrawal(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdateJournalWithdrawalDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<JournalWithdrawal> {
    return this.journalService.updateWithdrawal(
      id,
      input,
      request.user!.id,
    );
  }

  @Delete('withdrawals/:id')
  removeWithdrawal(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.journalService.removeWithdrawal(id);
  }
}
