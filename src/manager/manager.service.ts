import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { DepositLifecycleService } from '../deposits/deposit-lifecycle.service';

export interface ManagerContext {
  id: string;
  role: 'ADMIN' | 'MANAGER';
  email: string;
  username?: string | null;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WORKLIST_STATUSES = [
  'PAYMENT_PENDING',
  'PAYMENT_LATE',
  'PAYMENT_EXPIRED',
  'PAYMENT_CONFIRMED',
  'PROCESSING',
];
const UNMATCHED_LIMIT = 50;

const DEPOSIT_COLUMNS =
  'id, reference, player_id_1xbet, player_name, amount, bonus_percentage, bonus_amount, total_credit, status, declared_payment_phone, processed_by, processed_by_manager_id, processing_started_at, processed_at, matched_payment_id, expires_at, payment_started_at, payment_alerted_at, created_at';

@Injectable()
export class ManagerService {
  private readonly logger = new Logger(ManagerService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly depositLifecycle: DepositLifecycleService,
  ) {}

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
        processed_by: manager.username || manager.email,
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

  /**
   * Historique des depots credites (SUCCESS) avec recherche, periode, tri et
   * pagination cote serveur. Un MANAGER ne voit que ses propres depots, un
   * ADMIN voit ceux de tous les managers.
   * Parametres : q, period (today|yesterday|7d|30d|month), sort
   * (date_desc|date_asc|amount_desc|amount_asc), page, limit.
   */
/**
   * Petite empreinte pour savoir si quelque chose a change, sans
   * retelecharger toute la liste. L'app la consulte toutes les 4 secondes.
   */
  async getActivitySignature(manager: ManagerContext) {
    await this.depositLifecycle.sweepSafely();

    const isAdmin = manager.role === 'ADMIN';
    let query = this.supabase.client
      .from('deposits')
      .select('id, status, updated_at')
      .in('status', [
        'PAYMENT_PENDING',
        'PAYMENT_LATE',
        'PAYMENT_EXPIRED',
        'PAYMENT_CONFIRMED',
        'PROCESSING',
      ]);
    const { data: active, error: activeError } = await query.order('updated_at', { ascending: false }).limit(50);
    if (activeError) {
      throw new Error(`Erreur signature: ${activeError.message}`);
    }

    let successQuery = this.supabase.client
      .from('deposits')
      .select('processed_at')
      .eq('status', 'SUCCESS')
      .order('processed_at', { ascending: false, nullsFirst: false })
      .limit(1);
    if (!isAdmin) {
      successQuery = successQuery.eq('processed_by_manager_id', manager.id);
    }
    const { data: lastSuccess, error: successError } = await successQuery.maybeSingle();
    if (successError) {
      throw new Error(`Erreur signature: ${successError.message}`);
    }

    const { count: unmatchedCount, error: unmatchedError } = await this.supabase.client
      .from('orange_money_payments')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'UNMATCHED');
    if (unmatchedError) {
      throw new Error(`Erreur signature: ${unmatchedError.message}`);
    }

    const parts = (active ?? []).map(
      (r) => `${r.id}:${r.status}:${r.updated_at}`,
    );
    parts.push(`success:${lastSuccess?.processed_at ?? ''}`);
    parts.push(`unmatched:${unmatchedCount ?? 0}`);
    return { signature: parts.join('|') };
  }

  async listHistory(manager: ManagerContext, query: Record<string, string> = {}) {
    const DEFAULT_LIMIT = 20;
    const MAX_LIMIT = 100;
    const isAdmin = manager.role === 'ADMIN';

    const limitParsed = parseInt(query.limit ?? '', 10);
    const limit = Number.isFinite(limitParsed) ? Math.min(Math.max(limitParsed, 1), MAX_LIMIT) : DEFAULT_LIMIT;
    const pageParsed = parseInt(query.page ?? '', 10);
    const page = Number.isFinite(pageParsed) ? Math.max(pageParsed, 1) : 1;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const range = this.dateRange(query.date) ?? this.periodRange(query.period);
    const search = this.sanitizeSearch(query.q);

    let listQuery = this.supabase.client
      .from('deposits')
      .select(DEPOSIT_COLUMNS, { count: 'exact' })
      .eq('status', 'SUCCESS');
    if (!isAdmin) {
      listQuery = listQuery.eq('processed_by_manager_id', manager.id);
    }
    if (range) {
      listQuery = listQuery.gte('processed_at', range.from);
      if (range.to) {
        listQuery = listQuery.lt('processed_at', range.to);
      }
    }
    if (search) {
      listQuery = listQuery.or(
        `reference.ilike.%${search}%,player_id_1xbet.ilike.%${search}%,player_name.ilike.%${search}%,processed_by.ilike.%${search}%`,
      );
    }

    switch (query.sort) {
      case 'date_asc':
        listQuery = listQuery.order('processed_at', { ascending: true });
        break;
      case 'amount_desc':
        listQuery = listQuery
          .order('total_credit', { ascending: false })
          .order('processed_at', { ascending: false });
        break;
      case 'amount_asc':
        listQuery = listQuery
          .order('total_credit', { ascending: true })
          .order('processed_at', { ascending: false });
        break;
      default:
        listQuery = listQuery.order('processed_at', { ascending: false, nullsFirst: false });
    }

    const { data, error, count } = await listQuery.range(from, to);

    if (error) {
      throw new Error(`Erreur lecture historique: ${error.message}`);
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

    // Totaux du jour, independants des filtres (UTC = heure du Burkina Faso)
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);

    let todayQuery = this.supabase.client
      .from('deposits')
      .select('total_credit')
      .eq('status', 'SUCCESS')
      .gte('processed_at', startOfDay.toISOString());
    if (!isAdmin) {
      todayQuery = todayQuery.eq('processed_by_manager_id', manager.id);
    }
    const { data: todayRows, error: todayError } = await todayQuery;

    if (todayError) {
      throw new Error(`Erreur totaux du jour: ${todayError.message}`);
    }

    const todayList = todayRows ?? [];
    const todayTotal = todayList.reduce((sum, r) => sum + Number(r.total_credit), 0);
    const total = count ?? rows.length;

    return {
      todayCount: todayList.length,
      todayTotal,
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
      items: rows.map((r) => this.toDepositView(r, paymentsById.get(r.matched_payment_id))),
    };
  }

  /** Un jour precis (AAAA-MM-JJ). L'heure du Burkina Faso correspond a UTC. */
  private dateRange(date?: string): { from: string; to: string } | null {
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
    const start = Date.parse(`${date}T00:00:00Z`);
    if (Number.isNaN(start)) return null;
    return {
      from: new Date(start).toISOString(),
      to: new Date(start + 24 * 60 * 60 * 1000).toISOString(),
    };
  }

  private periodRange(period?: string): { from: string; to: string | null } | null {
    const now = new Date();
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const day = 24 * 60 * 60 * 1000;

    switch (period) {
      case 'today':
        return { from: startOfToday.toISOString(), to: null };
      case 'yesterday':
        return { from: new Date(startOfToday.getTime() - day).toISOString(), to: startOfToday.toISOString() };
      case '7d':
        return { from: new Date(startOfToday.getTime() - 6 * day).toISOString(), to: null };
      case '30d':
        return { from: new Date(startOfToday.getTime() - 29 * day).toISOString(), to: null };
      case 'month':
        return { from: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(), to: null };
      default:
        return null;
    }
  }

  /** Ne garde que des caracteres sans danger pour le filtre de recherche. */
  private sanitizeSearch(raw?: string): string {
    return (raw ?? '').replace(/[^\p{L}\p{N} @._-]/gu, '').trim().slice(0, 50);
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
      expiresAt: row.expires_at,
      paymentStartedAt: row.payment_started_at,
      paymentAlertedAt: row.payment_alerted_at,
      paymentAlert: row.payment_alerted_at
        ? {
            type: 'PAYMENT_NOT_DETECTED',
            message: 'Paiement non détecté',
          }
        : null,
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
