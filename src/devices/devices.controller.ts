import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AdminOnlyGuard } from '../auth/admin-only.guard';
import { DevicesService } from './devices.service';
import type { CreateDeviceDto, AssignDeviceDto } from './devices.types';

@Controller('admin/devices')
@UseGuards(JwtAuthGuard, AdminOnlyGuard)
export class DevicesController {
  constructor(private readonly devicesService: DevicesService) {}

  @Post()
  async create(@Body() dto: CreateDeviceDto, @Req() request: any) {
    return this.devicesService.createDevice(dto, request.manager.id);
  }

  @Get()
  async list() {
    return this.devicesService.listDevices();
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.devicesService.getDeviceById(id);
  }

  @Patch(':id/assign')
  async assign(@Param('id') id: string, @Body() dto: AssignDeviceDto) {
    return this.devicesService.assignDevice(id, dto);
  }

  @Patch(':id/unassign')
  async unassign(@Param('id') id: string) {
    return this.devicesService.unassignDevice(id);
  }

  @Patch(':id/status')
  async updateStatus(@Param('id') id: string, @Body('enabled') enabled: boolean) {
    return this.devicesService.updateDeviceStatus(id, enabled);
  }
}
