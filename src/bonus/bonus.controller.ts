import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../auth/admin-only.guard';
import { BonusService } from './bonus.service';
import type { CreateCampaignDto, UpdateCampaignDto } from './bonus.types';

@Controller('admin/bonus')
@UseGuards(JwtAuthGuard, AdminOnlyGuard)
export class BonusController {
  constructor(private readonly bonusService: BonusService) {}

  @Get()
  async list() {
    return this.bonusService.list();
  }

  @Post()
  async create(@Body() dto: CreateCampaignDto) {
    return this.bonusService.create(dto);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateCampaignDto) {
    return this.bonusService.update(id, dto);
  }

  @Post(':id/activate')
  async activate(@Param('id') id: string) {
    return this.bonusService.activate(id);
  }

  @Post(':id/stop')
  async stop(@Param('id') id: string) {
    return this.bonusService.stop(id);
  }
}
