import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { SupabaseService } from '../supabase/supabase.service';
import { JwtPayload } from './auth.types';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly supabase: SupabaseService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Token manquant');
    }

    const token = authHeader.replace('Bearer ', '');

    let payload: JwtPayload;
    try {
      payload = this.jwtService.verify(token);
    } catch (e) {
      throw new UnauthorizedException('Token invalide ou expire');
    }

    // Le JWT seul ne decide jamais des permissions : on revalide que
    // le compte existe toujours et est actif a chaque requete.
    const { data: account } = await this.supabase.client
      .from('manager_accounts')
      .select('id, role, enabled, username')
      .eq('id', payload.sub)
      .maybeSingle();

    if (!account || !account.enabled) {
      throw new UnauthorizedException('Compte invalide ou desactive');
    }

    request.manager = { id: account.id, role: account.role, email: payload.email, username: account.username };
    return true;
  }
}
