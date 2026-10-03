import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DepositsService } from './deposits.service';
import type {
  BonusInfoDto,
  CreateDepositDto,
  PreviewDepositDto,
} from './deposits.types';

@Controller('deposits')
export class DepositsController {
  constructor(private readonly depositsService: DepositsService) {}

  @Get('bonus-info')
  async bonusInfo(
    @Query('playerId') playerId: string,
    @Query('amount') amount: string,
  ) {
    const dto: BonusInfoDto = {
      playerId,
      amount: Number(amount),
    };

    return this.depositsService.bonusInfo(dto);
  }

  @Post('preview')
  async preview(@Body() dto: PreviewDepositDto) {
    return this.depositsService.previewDeposit(dto);
  }

  @Post()
  async create(@Body() dto: CreateDepositDto) {
    return this.depositsService.createDeposit(dto);
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.depositsService.getDeposit(id);
  }

  @Post(':id/cancel')
  async cancel(@Param('id') id: string) {
    return this.depositsService.cancelDeposit(id);
  }
}
