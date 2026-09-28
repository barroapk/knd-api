import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface ManagerContext {
  id: string;
  role: 'ADMIN' | 'MANAGER';
  email: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKLIST_STATUSES = ['PAYMENT_CONFIRMED', 'PROCESSING'];
const UNMATCHED_LIMIT = 50;

const DEPOSIT_COLUMNS =
  'id, reference, player_id_1xbet, player_name, amount, bonus_percentage, bonus_amount, total_credit, status, declared_payment_phone, processed_by, processed_by_manager_id, processing_started_at, processed_at, matched_payment_id, created_at';

@Injectable()
export class ManagerService {
  private readonly logger = new Logger(ManagerService.name);

  constructor(private readonly supabase: SupabaseService) {}

  /** Depots a traiter : payes (PAYMENT_CONFIRMED) ou deja pris en charge (PROCESSING). */
  async listDeposits() {
    const { data, error } = await this.supabase.client
      .from('deposits')
      .select(DEPOSIT_COLUMNS)
      .in('status', WORKLIST_STATUSES)
      .order('created_at', { ascending: true });

    if (error) {
      throw new Error(`Erreur lecture depots: ${error.message}`);
    }

    const rows = data ?? [];
    const paymentIds = rows.map((r) => r.matched_payment_id).filter((id): id is string => !!id);
    const paymentsById = new Map<string, any>();

    if (paymentIds.length > 0) {
      const { data: payments, error: paymentsError } = await this.supabase.client
        .from('orange_money_payments')
        .select('id, transaction_id, amount, sender_phone, sender_name, received_at')
        .in('id', paymentIds);

      if (paymentsError) {
        throw new Error(`Erreur lecture paiements: ${paymentsError.message}`);
      }
      for (const p of payments ?? []) {
        paymentsById.set(p.id, p);
      }
    }

    return rows.map((r) => this.toDepositView(r, paymentsById.get(r.matched_payment_id)));
  }

  /**
   * Prise en charge ATOMIQUE : la condition sur le statut est evaluee par
   * PostgreSQL au moment de l'ecriture. Si deux managers cliquent en meme
   * temps, un seul obtient la ligne, l'autre recoit 0 ligne modifiee.
   */
  async claim(id: string, manager: ManagerContext) {
    this.assertUuid(id);

    const { data, error } = await this.supabase.client
      .from('deposits')
      .update({
        status: 'PROCESSING',
        processed_by: manager.email,
        processed_by_manager_id: manager.id,
        processing_started_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'PAYMENT_CONFIRMED')
      .select(DEPOSIT_COLUMNS)
      .maybeSingle();

    if (error) {
      throw new Error(`Erreur prise en charge: ${error.message}`);
    }
    if (!data) {
      throw await this.explainFailure(id, 'claim', manager);
    }

    await this.logAction(id, 'DEPOSIT_CLAIMED', manager, {});
    return this.toDepositView(data);
  }

  /** "Credit effectue" : seul le manager qui a pris le depot peut le cloturer. */
  async complete(id: string, manager: ManagerContext) {
    this.assertUuid(id);

    const { data, error } = await this.supabase.client
      .from('deposits')
      .update({
        status: 'SUCCESS',
        processed_at: new Date().toISOString(),
      })
      .eq('id', id)
      .eq('status', 'PROCESSING')
      .eq('processed_by_manager_id', manager.id)
      .select(DEPOSIT_COLUMNS)
      .maybeSingle();

    if (error) {
      throw new Error(`Erreur cloture depot: ${error.message}`);
    }
    if (!data) {
      throw await this.explainFailure(id, 'complete', manager);
    }

    await this.logAction(id, 'DEPOSIT_COMPLETED', manager, {
      totalCredit: Number(data.total_credit),
    });
    return this.toDepositView(data);
  }

  /** Rend le depot a la file. Le proprietaire, ou un ADMIN pour debloquer. */
  async release(id: string, manager: ManagerContext) {
    this.assertUuid(id);

    let previousOwner: string | null = null;
    if (manager.role === 'ADMIN') {
      const { data: current } = await this.supabase.client
        .from('deposits')
        .select('processed_by')
        .eq('id', id)
        .maybeSingle();
      previousOwner = current?.processed_by ?? null;
    }

    let query = this.supabase.client
      .from('deposits')
      .update({
        status: 'PAYMENT_CONFIRMED',
        processed_by: null,
        processed_by_manager_id: null,
        processing_started_at: null,
      })
      .eq('id', id)
      .eq('status', 'PROCESSING');

    if (manager.role !== 'ADMIN') {
      query = query.eq('processed_by_manager_id', manager.id);
    }

    const { data, error } = await query.select(DEPOSIT_COLUMNS).maybeSingle();

    if (error) {
      throw new Error(`Erreur liberation depot: ${error.message}`);
    }
    if (!data) {
      throw await this.explainFailure(id, 'release', manager);
    }

    await this.logAction(id, 'DEPOSIT_RELEASED', manager, {
      previousOwner: previousOwner ?? manager.email,
      releasedByRole: manager.role,
    });
    return this.toDepositView(data);
  }

  /** Paiements recus sans depot (dont les paiements tardifs) : lecture seule. */
  async listUnmatchedPayments() {
    const { data, error } = await this.supabase.client
      .from('orange_money_payments')
      .select(
        'id, transaction_id, amount, sender_phone, sender_name, received_at, late_match_reason, matched_deposit_id, created_at',
      )
      .eq('status', 'UNMATCHED')
      .order('created_at', { ascending: false })
      .limit(UNMATCHED_LIMIT);

    if (error) {
      throw new Error(`Erreur lecture paiements non rapproches: ${error.message}`);
    }

    const rows = data ?? [];
    const depositIds = rows.map((r) => r.matched_deposit_id).filter((d): d is string => !!d);
    const depositsById = new Map<string, any>();

    if (depositIds.length > 0) {
      const { data: deposits, error: depositsError } = await this.supabase.client
        .from('deposits')
        .select('id, reference, status, player_name, amount')
        .in('id', depositIds);

      if (depositsError) {
        throw new Error(`Erreur lecture depots lies: ${depositsError.message}`);
      }
      for (const d of deposits ?? []) {
        depositsById.set(d.id, d);
      }
    }

    return rows.map((r) => {
      const linked = r.matched_deposit_id ? depositsById.get(r.matched_deposit_id) : null;
      return {
        id: r.id,
        transactionId: r.transaction_id,
        amount: Number(r.amount),
        senderPhone: r.sender_phone,
        senderName: r.sender_name,
        receivedAt: r.received_at,
        lateMatchReason: r.late_match_reason,
        createdAt: r.created_at,
        linkedDeposit: linked
          ? {
              id: linked.id,
              reference: linked.reference,
              status: linked.status,
              playerName: linked.player_name,
              amount: Number(linked.amount),
            }
          : null,
      };
    });
  }

  // ---------- helpers ----------

  /** Une mise a jour conditionnelle n'a rien modifie : on explique pourquoi. */
  private async explainFailure(id: string, action: 'claim' | 'complete' | 'release', manager: ManagerContext) {
    const { data } = await this.supabase.client
      .from('deposits')
      .select('status, processed_by, processed_by_manager_id')
      .eq('id', id)
      .maybeSingle();

    if (!data) {
      return new NotFoundException('Depot introuvable');
    }

    const owner = data.processed_by ?? 'un collegue';
    const isMine = data.processed_by_manager_id === manager.id;

    if (data.status === 'PROCESSING' && !isMine) {
      return new ConflictException(`Ce depot est deja pris en charge par ${owner}`);
    }
    if (action !== 'claim' && data.status === 'PAYMENT_CONFIRMED') {
      return new ConflictException("Ce depot n'est pas pris en charge : prenez-le d'abord en charge");
    }
    if (data.status === 'SUCCESS') {
      return new ConflictException('Ce depot est deja marque comme credite');
    }
    return new ConflictException(`Action impossible : le depot est au statut ${data.status}`);
  }

  private assertUuid(id: string) {
    if (!UUID_REGEX.test(id)) {
      throw new NotFoundException('Depot introuvable');
    }
  }

  private async logAction(depositId: string, action: string, manager: ManagerContext, details: object) {
    const { error } = await this.supabase.client.from('operation_log').insert({
      operation_type: 'deposit',
      operation_id: depositId,
      action,
      performed_by: manager.email,
      details,
    });
    if (error) {
      this.logger.warn(`Journal non enregistre (${action}): ${error.message}`);
    }
  }

  private toDepositView(row: any, payment?: any) {
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
      processedBy: row.processed_by,
      processedByManagerId: row.processed_by_manager_id,
      processingStartedAt: row.processing_started_at,
      processedAt: row.processed_at,
      createdAt: row.created_at,
      payment: payment
        ? {
            transactionId: payment.transaction_id,
            amount: Number(payment.amount),
            senderPhone: payment.sender_phone,
            senderName: payment.sender_name,
            receivedAt: payment.received_at,
          }
        : null,
    };
  }
}
