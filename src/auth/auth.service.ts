import { Injectable, UnauthorizedException, ConflictException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { SupabaseService } from '../supabase/supabase.service';
import { RegisterManagerDto, LoginDto, JwtPayload } from './auth.types';

@Injectable()
export class AuthService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterManagerDto) {
    const { data: existing } = await this.supabase.client
      .from('manager_accounts')
      .select('id')
      .eq('email', dto.email)
      .maybeSingle();

    if (existing) {
      throw new ConflictException('Un compte existe deja avec cet email');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);

    const { data, error } = await this.supabase.client
      .from('manager_accounts')
      .insert({
        email: dto.email,
        password_hash: passwordHash,
        display_name: dto.displayName,
        role: dto.role ?? 'MANAGER',
      })
      .select('id, email, display_name, role')
      .single();

    if (error) {
      throw new Error(`Erreur creation compte: ${error.message}`);
    }

    return data;
  }

  async login(dto: LoginDto) {
    const { data: account, error } = await this.supabase.client
      .from('manager_accounts')
      .select('id, email, password_hash, display_name, role, enabled')
      .eq('email', dto.email)
      .maybeSingle();

    if (error || !account) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    if (!account.enabled) {
      throw new UnauthorizedException('Compte desactive');
    }

    const passwordMatches = await bcrypt.compare(dto.password, account.password_hash);
    if (!passwordMatches) {
      throw new UnauthorizedException('Identifiants invalides');
    }

    await this.supabase.client
      .from('manager_accounts')
      .update({ last_login_at: new Date().toISOString() })
      .eq('id', account.id);

    const payload: JwtPayload = {
      sub: account.id,
      email: account.email,
      role: account.role,
    };

    const token = this.jwtService.sign(payload);

    return {
      accessToken: token,
      manager: {
        id: account.id,
        email: account.email,
        displayName: account.display_name,
        role: account.role,
      },
    };
  }
}
