import { Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { ManagerService } from './manager.service';

@Controller('manager')
@UseGuards(JwtAuthGuard)
export class ManagerController {
  constructor(private readonly managerService: ManagerService) {}

  @Get('deposits')
  async listDeposits() {
    return this.managerService.listDeposits();
  }

  @Post('deposits/:id/claim')
  async claim(@Param('id') id: string, @Req() request: any) {
    return this.managerService.claim(id, request.manager);
  }

  @Post('deposits/:id/complete')
  async complete(@Param('id') id: string, @Req() request: any) {
    return this.managerService.complete(id, request.manager);
  }

  @Post('deposits/:id/release')
  async release(@Param('id') id: string, @Req() request: any) {
    return this.managerService.release(id, request.manager);
  }

  @Get('payments/unmatched')
  async listUnmatchedPayments() {
    return this.managerService.listUnmatchedPayments();
  }
}
