import {
  Injectable,
  ConflictException,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { SupabaseService } from '../supabase/supabase.service';
import {
  CreateManagerDto,
  UpdateManagerDto,
  UpdateManagerStatusDto,
  UpdateManagerRoleDto,
} from './admin.types';

const SAFE_COLUMNS = 'id, email, username, display_name, role, enabled, last_login_at, created_at, updated_at';

@Injectable()
export class AdminService {
  constructor(private readonly supabase: SupabaseService) {}

  async createManager(dto: CreateManagerDto) {
    const rawUsername = (dto.username ?? String(dto.email ?? '').split('@')[0]).trim().toLowerCase();
    const username = rawUsername.replace(/[^a-z0-9._-]/g, '');
    if (!/^[a-z0-9._-]{3,30}$/.test(username)) {
      throw new BadRequestException("Nom d'utilisateur invalide (3 a 30 caracteres : lettres, chiffres, point, tiret)");
    }
    if (!dto.password || dto.password.length < 8) {
      throw new BadRequestException('Mot de passe trop court (8 caracteres minimum)');
    }
    const { data: usernameTaken } = await this.supabase.client
      .from('manager_accounts')
      .select('id')
      .eq('username', username)
      .maybeSingle();
    if (usernameTaken) {
      throw new ConflictException("Ce nom d'utilisateur est deja pris");
    }

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
        username,
        email: dto.email,
        password_hash: passwordHash,
        display_name: dto.displayName,
        role: dto.role ?? 'MANAGER',
      })
      .select(SAFE_COLUMNS)
      .single();

    if (error) {
      throw new Error(`Erreur creation manager: ${error.message}`);
    }

    return data;
  }

  async listManagers() {
    const { data, error } = await this.supabase.client
      .from('manager_accounts')
      .select(SAFE_COLUMNS)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Erreur listing managers: ${error.message}`);
    }

    return data;
  }

  async getManagerById(id: string) {
    const { data, error } = await this.supabase.client
      .from('manager_accounts')
      .select(SAFE_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException('Manager introuvable');
    }

    return data;
  }

  async updateManager(id: string, dto: UpdateManagerDto) {
    await this.getManagerById(id); // 404 si inexistant

    const { data, error } = await this.supabase.client
      .from('manager_accounts')
      .update({ display_name: dto.displayName })
      .eq('id', id)
      .select(SAFE_COLUMNS)
      .single();

    if (error) {
      throw new Error(`Erreur mise a jour manager: ${error.message}`);
    }

    return data;
  }

  async updateManagerStatus(id: string, dto: UpdateManagerStatusDto, requestingAdminId: string) {
    if (id === requestingAdminId && dto.enabled === false) {
      throw new ForbiddenException('Vous ne pouvez pas desactiver votre propre compte');
    }

    await this.getManagerById(id);

    const { data, error } = await this.supabase.client
      .from('manager_accounts')
      .update({ enabled: dto.enabled })
      .eq('id', id)
      .select(SAFE_COLUMNS)
      .single();

    if (error) {
      throw new Error(`Erreur changement statut: ${error.message}`);
    }

    return data;
  }

  async updateManagerRole(id: string, dto: UpdateManagerRoleDto, requestingAdminId: string) {
    // Regle de securite : un ADMIN ne peut jamais changer son propre role,
    // pour eviter un auto-verrouillage accidentel (plus aucun ADMIN restant).
    if (id === requestingAdminId) {
      throw new ForbiddenException('Vous ne pouvez pas modifier votre propre role');
    }

    await this.getManagerById(id);

    const { data, error } = await this.supabase.client
      .from('manager_accounts')
      .update({ role: dto.role })
      .eq('id', id)
      .select(SAFE_COLUMNS)
      .single();

    if (error) {
      throw new Error(`Erreur changement role: ${error.message}`);
    }

    return data;
  }
}
