import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { randomBytes, createHash } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { CreateDeviceDto, AssignDeviceDto } from './devices.types';

const SAFE_COLUMNS =
  'id, device_name, enabled, authorized_by, assigned_manager_id, last_seen_at, created_at, updated_at';

function generateDeviceToken(): string {
  return randomBytes(32).toString('hex');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

@Injectable()
export class DevicesService {
  constructor(private readonly supabase: SupabaseService) {}

  async createDevice(dto: CreateDeviceDto, adminId: string) {
    const token = generateDeviceToken();
    const tokenHash = hashToken(token);

    const { data, error } = await this.supabase.client
      .from('bridge_devices')
      .insert({
        device_name: dto.deviceName,
        auth_token_hash: tokenHash,
        authorized_by: adminId,
      })
      .select(SAFE_COLUMNS)
      .single();

    if (error) {
      throw new Error(`Erreur creation device: ${error.message}`);
    }

    // Le token en clair n'est JAMAIS stocke - c'est la seule fois qu'il
    // est visible. S'il est perdu, il faut desactiver ce device et en
    // creer un nouveau.
    return {
      device: this.toCamelCase(data),
      deviceToken: token,
    };
  }

  async listDevices() {
    const { data, error } = await this.supabase.client
      .from('bridge_devices')
      .select(SAFE_COLUMNS)
      .order('created_at', { ascending: false });

    if (error) {
      throw new Error(`Erreur listing devices: ${error.message}`);
    }

    return data.map((d) => this.toCamelCase(d));
  }

  async getDeviceById(id: string) {
    const { data, error } = await this.supabase.client
      .from('bridge_devices')
      .select(SAFE_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error || !data) {
      throw new NotFoundException('Appareil introuvable');
    }

    return this.toCamelCase(data);
  }

  async assignDevice(id: string, dto: AssignDeviceDto) {
    await this.getDeviceById(id); // 404 si device inexistant

    const { data: manager } = await this.supabase.client
      .from('manager_accounts')
      .select('id, enabled')
      .eq('id', dto.managerId)
      .maybeSingle();

    if (!manager) {
      throw new BadRequestException('Manager introuvable');
    }
    if (!manager.enabled) {
      throw new BadRequestException('Ce manager est desactive');
    }

    const { data, error } = await this.supabase.client
      .from('bridge_devices')
      .update({ assigned_manager_id: dto.managerId })
      .eq('id', id)
      .select(SAFE_COLUMNS)
      .single();

    if (error) {
      throw new Error(`Erreur affectation device: ${error.message}`);
    }

    return this.toCamelCase(data);
  }

  async unassignDevice(id: string) {
    await this.getDeviceById(id);

    const { data, error } = await this.supabase.client
      .from('bridge_devices')
      .update({ assigned_manager_id: null })
      .eq('id', id)
      .select(SAFE_COLUMNS)
      .single();

    if (error) {
      throw new Error(`Erreur retrait affectation: ${error.message}`);
    }

    return this.toCamelCase(data);
  }

  async updateDeviceStatus(id: string, enabled: boolean) {
    await this.getDeviceById(id);

    const { data, error } = await this.supabase.client
      .from('bridge_devices')
      .update({ enabled })
      .eq('id', id)
      .select(SAFE_COLUMNS)
      .single();

    if (error) {
      throw new Error(`Erreur changement statut device: ${error.message}`);
    }

    return this.toCamelCase(data);
  }

  /**
   * Utilise par le futur webhook (A5) : verifie un token recu en clair
   * en le hashant et en comparant au hash stocke. Retourne le device
   * uniquement s'il est enabled=true.
   */
  async verifyDeviceToken(rawToken: string) {
    const tokenHash = hashToken(rawToken);

    const { data, error } = await this.supabase.client
      .from('bridge_devices')
      .select('id, enabled, assigned_manager_id')
      .eq('auth_token_hash', tokenHash)
      .maybeSingle();

    if (error || !data || !data.enabled) {
      return null;
    }

    await this.supabase.client
      .from('bridge_devices')
      .update({ last_seen_at: new Date().toISOString() })
      .eq('id', data.id);

    return data;
  }

  private toCamelCase(row: any) {
    return {
      id: row.id,
      deviceName: row.device_name,
      enabled: row.enabled,
      authorizedBy: row.authorized_by,
      assignedManagerId: row.assigned_manager_id,
      lastSeenAt: row.last_seen_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }
}
