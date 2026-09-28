import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AdminOnlyGuard } from './admin-only.guard';
import { AuthService } from './auth.service';
import type { RegisterManagerDto, LoginDto } from './auth.types';

@Controller('auth/manager')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @UseGuards(JwtAuthGuard, AdminOnlyGuard)
  async register(@Body() dto: RegisterManagerDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }
}
