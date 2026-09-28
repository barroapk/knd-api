import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { DepositsService } from './deposits.service';
import type { CreateDepositDto } from './deposits.types';

@Controller('deposits')
export class DepositsController {
  constructor(private readonly depositsService: DepositsService) {}

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
