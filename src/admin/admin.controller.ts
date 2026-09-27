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
import { AdminService } from './admin.service';
import type {
  CreateManagerDto,
  UpdateManagerDto,
  UpdateManagerStatusDto,
  UpdateManagerRoleDto,
} from './admin.types';

@Controller('admin/managers')
@UseGuards(JwtAuthGuard, AdminOnlyGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Post()
  async create(@Body() dto: CreateManagerDto) {
    return this.adminService.createManager(dto);
  }

  @Get()
  async list() {
    return this.adminService.listManagers();
  }

  @Get(':id')
  async getOne(@Param('id') id: string) {
    return this.adminService.getManagerById(id);
  }

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateManagerDto) {
    return this.adminService.updateManager(id, dto);
  }

  @Patch(':id/status')
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateManagerStatusDto,
    @Req() request: any,
  ) {
    return this.adminService.updateManagerStatus(id, dto, request.manager.id);
  }

  @Patch(':id/role')
  async updateRole(
    @Param('id') id: string,
    @Body() dto: UpdateManagerRoleDto,
    @Req() request: any,
  ) {
    return this.adminService.updateManagerRole(id, dto, request.manager.id);
  }
}
