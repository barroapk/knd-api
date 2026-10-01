import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import type { CreateCampaignDto, UpdateCampaignDto } from './bonus.types';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const COLUMNS =
  'id, name, percentage, returning_percentage, is_active, starts_at, ends_at, min_deposit, max_bonus, created_at';
const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class BonusService {
  constructor(private readonly supabase: SupabaseService) {}

  async list() {
    const { data, error } = await this.supabase.client
      .from('bonus_campaigns')
      .select(COLUMNS)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) {
      throw new Error(`Erreur lecture campagnes: ${error.message}`);
    }
    return (data ?? []).map((row) => this.toView(row));
  }

  async create(dto: CreateCampaignDto) {
    const name = String(dto?.name ?? '').trim();
    const percentage = dto?.percentage;
    const returningPercentage = dto?.returningPercentage ?? null;
    const startsMs = Date.parse(String(dto?.startsAt ?? ''));
    const endsMs = Date.parse(String(dto?.endsAt ?? ''));
    const minDeposit = dto?.minDeposit ?? 0;
    const maxBonus = dto?.maxBonus ?? null;

    this.validateFields({ name, percentage, returningPercentage, startsMs, endsMs, minDeposit, maxBonus });

    // Creee inactive : l'activation est une action distincte et volontaire.
    const { data, error } = await this.supabase.client
      .from('bonus_campaigns')
      .insert({
        name,
        percentage,
        returning_percentage: returningPercentage,
        starts_at: new Date(startsMs).toISOString(),
        ends_at: new Date(endsMs).toISOString(),
        min_deposit: minDeposit,
        max_bonus: maxBonus,
        is_active: false,
      })
      .select(COLUMNS)
      .single();
    if (error) {
      throw new Error(`Erreur creation campagne: ${error.message}`);
    }
    return this.toView(data);
  }

  /**
   * Modifie une campagne existante (nom, pourcentages, seuils, dates).
   * N'affecte jamais les depots deja crees : leur bonus_percentage,
   * bonus_amount et total_credit restent figes en snapshot (voir
   * deposits.service.ts), quelle que soit la modification faite ici.
   */
  async update(id: string, dto: UpdateCampaignDto) {
    const current = await this.getOrThrow(id);

    const name = dto.name !== undefined ? String(dto.name).trim() : current.name;
    const percentage = dto.percentage !== undefined ? dto.percentage : Number(current.percentage);
    const returningPercentage =
      dto.returningPercentage !== undefined
        ? dto.returningPercentage
        : current.returning_percentage !== null && current.returning_percentage !== undefined
          ? Number(current.returning_percentage)
          : null;
    const startsMs = dto.startsAt !== undefined ? Date.parse(dto.startsAt) : Date.parse(current.starts_at);
    const endsMs = dto.endsAt !== undefined ? Date.parse(dto.endsAt) : Date.parse(current.ends_at);
    const minDeposit = dto.minDeposit !== undefined ? dto.minDeposit : Number(current.min_deposit ?? 0);
    const maxBonus =
      dto.maxBonus !== undefined
        ? dto.maxBonus
        : current.max_bonus === null || current.max_bonus === undefined
          ? null
          : Number(current.max_bonus);

    this.validateFields({ name, percentage, returningPercentage, startsMs, endsMs, minDeposit, maxBonus });

    const { data, error } = await this.supabase.client
      .from('bonus_campaigns')
      .update({
        name,
        percentage,
        returning_percentage: returningPercentage,
        starts_at: new Date(startsMs).toISOString(),
        ends_at: new Date(endsMs).toISOString(),
        min_deposit: minDeposit,
        max_bonus: maxBonus,
      })
      .eq('id', id)
      .select(COLUMNS)
      .single();
    if (error) {
      throw new Error(`Erreur modification campagne: ${error.message}`);
    }
    return this.toView(data);
  }

  async activate(id: string) {
    const campaign = await this.getOrThrow(id);
    if (Date.parse(campaign.ends_at) <= Date.now()) {
      throw new BadRequestException('Cette campagne est terminee : creez-en une nouvelle');
    }

    // Une seule campagne active a la fois : on eteint l'eventuelle campagne en cours.
    const { error: offError } = await this.supabase.client
      .from('bonus_campaigns')
      .update({ is_active: false })
      .eq('is_active', true);
    if (offError) {
      throw new Error(`Erreur arret campagne precedente: ${offError.message}`);
    }

    const { data, error } = await this.supabase.client
      .from('bonus_campaigns')
      .update({ is_active: true })
      .eq('id', id)
      .select(COLUMNS)
      .single();
    if (error) {
      if (error.code === POSTGRES_UNIQUE_VIOLATION) {
        throw new ConflictException('Une autre campagne vient d etre activee, reessayez');
      }
      throw new Error(`Erreur activation campagne: ${error.message}`);
    }
    return this.toView(data);
  }

  async stop(id: string) {
    await this.getOrThrow(id);
    const { data, error } = await this.supabase.client
      .from('bonus_campaigns')
      .update({ is_active: false })
      .eq('id', id)
      .select(COLUMNS)
      .single();
    if (error) {
      throw new Error(`Erreur arret campagne: ${error.message}`);
    }
    return this.toView(data);
  }

  private validateFields(fields: {
    name: string;
    percentage: number;
    returningPercentage: number | null;
    startsMs: number;
    endsMs: number;
    minDeposit: number;
    maxBonus: number | null;
  }) {
    const { name, percentage, returningPercentage, startsMs, endsMs, minDeposit, maxBonus } = fields;

    if (name.length < 1 || name.length > 60) {
      throw new BadRequestException('Nom de campagne requis (60 caracteres maximum)');
    }
    if (typeof percentage !== 'number' || !(percentage > 0) || percentage > 100) {
      throw new BadRequestException('Pourcentage invalide (entre 0 et 100)');
    }
    if (
      returningPercentage !== null &&
      (typeof returningPercentage !== 'number' || returningPercentage < 0 || returningPercentage > 100)
    ) {
      throw new BadRequestException('Pourcentage dépôts suivants invalide (entre 0 et 100)');
    }
    if (Number.isNaN(startsMs) || Number.isNaN(endsMs)) {
      throw new BadRequestException('Dates invalides (format ISO attendu)');
    }
    if (endsMs <= startsMs) {
      throw new BadRequestException('La date de fin doit etre apres la date de debut');
    }
    if (endsMs <= Date.now()) {
      throw new BadRequestException('La date de fin est deja passee');
    }
    if (typeof minDeposit !== 'number' || minDeposit < 0) {
      throw new BadRequestException('Depot minimum invalide');
    }
    if (maxBonus !== null && (typeof maxBonus !== 'number' || maxBonus <= 0)) {
      throw new BadRequestException('Bonus maximum invalide');
    }
  }

  private async getOrThrow(id: string) {
    if (!UUID_REGEX.test(id)) {
      throw new NotFoundException('Campagne introuvable');
    }
    const { data, error } = await this.supabase.client
      .from('bonus_campaigns')
      .select(COLUMNS)
      .eq('id', id)
      .maybeSingle();
    if (error) {
      throw new Error(`Erreur lecture campagne: ${error.message}`);
    }
    if (!data) {
      throw new NotFoundException('Campagne introuvable');
    }
    return data;
  }

  private toView(row: any) {
    const now = Date.now();
    const starts = Date.parse(row.starts_at);
    const ends = Date.parse(row.ends_at);
    let state = 'INACTIVE';
    if (ends <= now) {
      state = 'ENDED';
    } else if (row.is_active) {
      state = starts <= now ? 'RUNNING' : 'SCHEDULED';
    }
    return {
      id: row.id,
      name: row.name,
      percentage: Number(row.percentage),
      returningPercentage:
        row.returning_percentage === null || row.returning_percentage === undefined
          ? null
          : Number(row.returning_percentage),
      isActive: row.is_active,
      state,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      minDeposit: Number(row.min_deposit ?? 0),
      maxBonus: row.max_bonus === null || row.max_bonus === undefined ? null : Number(row.max_bonus),
      createdAt: row.created_at,
    };
  }
}
