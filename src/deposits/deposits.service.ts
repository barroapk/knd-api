import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomInt } from 'crypto';
import { SupabaseService } from '../supabase/supabase.service';
import { NafaCashVerificationProvider } from '../player-verification/nafacash-verification.provider';
import type { CreateDepositDto } from './deposits.types';
import { DepositLifecycleService } from './deposit-lifecycle.service';

const MIN_DEPOSIT = 100;
const MAX_DEPOSIT = 500000;
const PENDING_WINDOW_MINUTES = 3;
const POSTGRES_UNIQUE_VIOLATION = '23505';
const MAX_REFERENCE_ATTEMPTS = 5;
const CANCELLABLE_STATUSES = ['PAYMENT_PENDING', 'PAYMENT_LATE'];
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DEPOSIT_COLUMNS =
  'id, reference, player_id_1xbet, player_name, amount, bonus_percentage, bonus_amount, total_credit, status, declared_payment_phone, ussd_code_used, merchant_name_used, expires_at, created_at';

/** 8 chiffres (07802610) ou 11 chiffres avec 226 -> format 226XXXXXXXX */
export function normalizePhone(raw: string): string | null {
  const digits = String(raw ?? '').replace(/\D/g, '');
  if (digits.length === 8) return `226${digits}`;
  if (digits.length === 11 && digits.startsWith('226')) return digits;
  return null;
}

@Injectable()
export class DepositsService {
  private readonly logger = new Logger(DepositsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly playerVerification: NafaCashVerificationProvider,
    private readonly lifecycle: DepositLifecycleService,
  ) {}

  async createDeposit(dto: CreateDepositDto) {
    const playerId = String(dto?.playerId ?? '').trim();
    const amount = dto?.amount;
    const paymentPhone = normalizePhone(dto?.paymentPhone);

    if (!/^\d{5,15}$/.test(playerId)) {
      throw new BadRequestException('Identifiant 1xBet invalide');
    }
    if (
      typeof amount !== 'number' ||
      !Number.isInteger(amount) ||
      amount < MIN_DEPOSIT ||
      amount > MAX_DEPOSIT
    ) {
      throw new BadRequestException(
        `Montant invalide (entre ${MIN_DEPOSIT} et ${MAX_DEPOSIT} FCFA, sans decimales)`,
      );
    }
    if (!paymentPhone) {
      throw new BadRequestException('Numero Orange Money invalide');
    }

    // Libere d'abord les numeros dont le depot a expire.
    await this.lifecycle.sweepSafely();

    const player = await this.verifyPlayer(playerId);
    const config = await this.getActivePaymentConfig();
    const now = new Date();
    const bonus = await this.getActiveBonus(now);

    // Le serveur est la seule autorite sur le bonus. Arrondi vers le bas :
    // on ne credite jamais plus que le pourcentage annonce.
    const computed = this.computeBonus(bonus, amount);
    const bonusPercentage = computed.percentage;
    const bonusAmount = computed.bonusAmount;
    const totalCredit = amount + bonusAmount;

    const ussdCode = String(config.orange_money_ussd_template)
      .split('{AMOUNT}').join(String(amount))
      .split('{MERCHANT_PHONE}').join(String(config.orange_money_merchant_phone));

    const expiresAt = new Date(now.getTime() + PENDING_WINDOW_MINUTES * 60 * 1000);

    for (let attempt = 1; attempt <= MAX_REFERENCE_ATTEMPTS; attempt++) {
      const reference = this.generateReference(now);

      const { data, error } = await this.supabase.client
        .from('deposits')
        .insert({
          reference,
          player_id_1xbet: player.id,
          player_name: player.name,
          amount,
          bonus_campaign_id: computed.campaignId,
          bonus_percentage: bonusPercentage,
          bonus_amount: bonusAmount,
          total_credit: totalCredit,
          declared_payment_phone: paymentPhone,
          ussd_code_used: ussdCode,
          merchant_name_used: config.orange_money_merchant_name,
          expires_at: expiresAt.toISOString(),
          status: 'PAYMENT_PENDING',
        })
        .select(DEPOSIT_COLUMNS)
        .single();

      if (!error && data) {
        await this.logOperation(data.id, 'DEPOSIT_CREATED', { reference, amount, bonusAmount });
        return this.toView(data, config.support_whatsapp);
      }

      if (error?.code === POSTGRES_UNIQUE_VIOLATION) {
        const message = error.message ?? '';
        if (message.includes('idx_deposits_one_active_per_phone')) {
          throw new ConflictException(
            "Ce numero Orange Money a deja une operation en cours. Attendez son traitement ou annulez-la si aucun paiement n'a encore ete effectue.",
          );
        }
        if (message.includes('reference')) {
          continue; // collision de reference, on retente avec une autre
        }
      }

      throw new Error(`Erreur creation depot: ${error?.message}`);
    }

    throw new Error('Impossible de generer une reference unique');
  }

  async getDeposit(id: string) {
    this.assertUuid(id);
    await this.lifecycle.sweepSafely();

    const { data, error } = await this.supabase.client
      .from('deposits')
      .select(DEPOSIT_COLUMNS)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw new Error(`Erreur lecture depot: ${error.message}`);
    }
    if (!data) {
      throw new NotFoundException('Depot introuvable');
    }

    const config = await this.getActivePaymentConfigOrNull();
    return this.toView(data, config ? config.support_whatsapp : null);
  }

  async cancelDeposit(id: string) {
    this.assertUuid(id);

    // Annulation possible uniquement tant qu'aucun paiement n'est detecte.
    const { data, error } = await this.supabase.client
      .from('deposits')
      .update({ status: 'CANCELLED' })
      .eq('id', id)
      .in('status', CANCELLABLE_STATUSES)
      .select(DEPOSIT_COLUMNS)
      .maybeSingle();

    if (error) {
      throw new Error(`Erreur annulation depot: ${error.message}`);
    }

    if (!data) {
      await this.getDeposit(id); // leve NotFound si le depot n'existe pas
      throw new ConflictException('Ce depot ne peut plus etre annule');
    }

    await this.logOperation(id, 'DEPOSIT_CANCELLED', {});
    const config = await this.getActivePaymentConfigOrNull();
    return this.toView(data, config ? config.support_whatsapp : null);
  }

  // ---------- helpers ----------

  private async verifyPlayer(playerId: string) {
    let result;
    try {
      result = await this.playerVerification.verifyPlayer(playerId);
    } catch (e) {
      throw new ServiceUnavailableException(
        'Verification du compte indisponible, reessayez dans un instant',
      );
    }

    if (!result.valid || !result.playerName) {
      throw new NotFoundException('Compte 1xBet introuvable');
    }

    const { error } = await this.supabase.client
      .from('players_verified')
      .upsert(
        {
          player_id_1xbet: playerId,
          player_name: result.playerName,
          last_verified_at: new Date().toISOString(),
        },
        { onConflict: 'player_id_1xbet' },
      );
    if (error) {
      this.logger.warn(`Cache joueur non enregistre: ${error.message}`);
    }

    return { id: playerId, name: result.playerName as string };
  }

  private async getActivePaymentConfigOrNull() {
    const { data, error } = await this.supabase.client
      .from('payment_config')
      .select(
        'orange_money_ussd_template, orange_money_merchant_name, orange_money_merchant_phone, support_whatsapp',
      )
      .eq('is_active', true)
      .maybeSingle();

    if (error) {
      throw new Error(`Erreur lecture configuration paiement: ${error.message}`);
    }
    return data;
  }

  private async getActivePaymentConfig() {
    const config = await this.getActivePaymentConfigOrNull();
    if (!config) {
      throw new ServiceUnavailableException('Configuration de paiement absente');
    }
    return config;
  }

  private async getActiveBonus(now: Date) {
    const iso = now.toISOString();
    const { data, error } = await this.supabase.client
      .from('bonus_campaigns')
      .select('id, percentage, min_deposit, max_bonus')
      .eq('is_active', true)
      .lte('starts_at', iso)
      .gt('ends_at', iso)
      .maybeSingle();

    if (error) {
      throw new Error(`Erreur lecture bonus: ${error.message}`);
    }
    return data;
  }

  /** Applique le depot minimum et le bonus maximum de la campagne active. */
  private computeBonus(bonus: any, amount: number) {
    const none = { campaignId: null as string | null, percentage: 0, bonusAmount: 0 };
    if (!bonus) return none;
    if (amount < Number(bonus.min_deposit ?? 0)) return none;
    const percentage = Number(bonus.percentage);
    let bonusAmount = Math.floor((amount * percentage) / 100);
    if (bonus.max_bonus !== null && bonus.max_bonus !== undefined) {
      bonusAmount = Math.min(bonusAmount, Math.floor(Number(bonus.max_bonus)));
    }
    return { campaignId: String(bonus.id), percentage, bonusAmount };
  }

  private generateReference(now: Date): string {
    const y = now.getUTCFullYear();
    const m = String(now.getUTCMonth() + 1).padStart(2, '0');
    const d = String(now.getUTCDate()).padStart(2, '0');
    const suffix = String(randomInt(0, 10000)).padStart(4, '0');
    return `KND-${y}${m}${d}-${suffix}`;
  }

  private assertUuid(id: string) {
    if (!UUID_REGEX.test(id)) {
      throw new NotFoundException('Depot introuvable');
    }
  }

  private async logOperation(depositId: string, action: string, details: object) {
    const { error } = await this.supabase.client.from('operation_log').insert({
      operation_type: 'deposit',
      operation_id: depositId,
      action,
      performed_by: 'CLIENT',
      details,
    });
    if (error) {
      this.logger.warn(`Journal non enregistre (${action}): ${error.message}`);
    }
  }

  private toView(row: any, supportWhatsapp: string | null) {
    return {
      id: row.id,
      reference: row.reference,
      playerId: row.player_id_1xbet,
      playerName: row.player_name,
      amount: Number(row.amount),
      bonusPercentage: Number(row.bonus_percentage),
      bonusAmount: Number(row.bonus_amount),
      totalCredit: Number(row.total_credit),
      status: row.status,
      paymentPhone: row.declared_payment_phone,
      ussdCode: row.ussd_code_used,
      merchantName: row.merchant_name_used,
      supportWhatsapp,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
    };
  }
}
