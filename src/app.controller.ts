import { Controller, Get, UseGuards } from '@nestjs/common';
import { AppService } from './app.service';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { AdminOnlyGuard } from './auth/admin-only.guard';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('ping')
  ping() {
    return 'ok';
  }

  @Get('test-protected')
  @UseGuards(JwtAuthGuard)
  testProtected() {
    return {
      success: true,
      message: 'JWT valide, route protégée accessible',
    };
  }

  @Get('test-admin')
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  testAdmin() {
    return {
      success: true,
      message: 'Acces ADMIN confirme',
    };
  }
}
