import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

const ALERT_AFTER_SECONDS = 45;
const LATE_AFTER_MINUTES = 3;
const EXPIRE_AFTER_MINUTES = 10;
const SWEEP_INTERVAL_MS = 30000;

/**
 * Fait avancer les depots dans le temps, a partir de payment_started_at
 * (le moment ou le client est reellement entre dans l'ecran de paiement),
 * jamais created_at. Le plan gratuit de Render endort le serveur : le
 * minuteur ne suffit donc pas, sweepSafely() est aussi appele a chaque
 * creation/lecture de depot.
 */
@Injectable()
export class DepositLifecycleService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(DepositLifecycleService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly supabase: SupabaseService) {}

  onModuleInit() {
    this.timer = setInterval(() => {
      void this.sweepSafely();
    }, SWEEP_INTERVAL_MS);
  }

  onModuleDestroy() {
    if (this.timer) {
      clearInterval(this.timer);
    }
  }

  async sweepSafely() {
    try {
      await this.sweep();
    } catch (e) {
      this.logger.warn(`Balayage des delais echoue: ${(e as Error).message}`);
    }
  }

  async sweep(now: Date = new Date()) {
    const alertCutoff = new Date(now.getTime() - ALERT_AFTER_SECONDS * 1000).toISOString();
    const lateCutoff = new Date(now.getTime() - LATE_AFTER_MINUTES * 60 * 1000).toISOString();
    const expireCutoff = new Date(now.getTime() - EXPIRE_AFTER_MINUTES * 60 * 1000).toISOString();

    // Ordre : alerte d'abord, puis retard, puis expiration.
    // Ainsi, meme si Render se reveille tardivement, un depot qui a
    // depasse 45 secondes recoit bien son signal "paiement non detecte"
    // avant de changer de statut.
    await this.alertUndetectedPayments(alertCutoff);

    await this.transitionStatus(
      ['PAYMENT_PENDING'],
      'PAYMENT_LATE',
      lateCutoff,
      'DEPOSIT_LATE',
    );

    await this.transitionStatus(
      ['PAYMENT_PENDING', 'PAYMENT_LATE'],
      'PAYMENT_EXPIRED',
      expireCutoff,
      'DEPOSIT_EXPIRED',
    );
  }

  /**
   * Transition de statut basee sur payment_started_at. Un depot sans
   * payment_started_at (ancien format, ou creation anterieure a ce
   * changement) n'est jamais transitionne par cette fonction : il garde
   * son comportement actuel plutot que de planter ou d'etre ignore
   * silencieusement de facon surprenante.
   */
  private async transitionStatus(from: string[], to: string, cutoffIso: string, action: string) {
    const { data, error } = await this.supabase.client
      .from('deposits')
      .update({ status: to })
      .in('status', from)
      .not('payment_started_at', 'is', null)
      .lt('payment_started_at', cutoffIso)
      .select('id');

    if (error) {
      throw new Error(`Transition ${to}: ${error.message}`);
    }

    for (const row of data ?? []) {
      const { error: logError } = await this.supabase.client.from('operation_log').insert({
        operation_type: 'deposit',
        operation_id: row.id,
        action,
        performed_by: 'SYSTEM',
        details: {},
      });
      if (logError) {
        this.logger.warn(`Journal non enregistre (${action}): ${logError.message}`);
      }
    }
  }

  /**
   * Signal "paiement non detecte" a 45s : ne change JAMAIS le statut.
   * Le paiement a pu reellement etre effectue (SMS en retard, reseau),
   * donc ceci est une invitation a verifier manuellement (Max it, etc.),
   * jamais une affirmation que le client n'a pas paye.
   */
  private async alertUndetectedPayments(cutoffIso: string) {
    const { data, error } = await this.supabase.client
      .from('deposits')
      .update({ payment_alerted_at: new Date().toISOString() })
      .eq('status', 'PAYMENT_PENDING')
      .is('payment_alerted_at', null)
      .not('payment_started_at', 'is', null)
      .lt('payment_started_at', cutoffIso)
      .select('id');

    if (error) {
      throw new Error(`Alerte paiement non detecte: ${error.message}`);
    }

    for (const row of data ?? []) {
      const { error: logError } = await this.supabase.client.from('operation_log').insert({
        operation_type: 'deposit',
        operation_id: row.id,
        action: 'PAYMENT_NOT_DETECTED_ALERT',
        performed_by: 'SYSTEM',
        details: {},
      });
      if (logError) {
        this.logger.warn(`Journal non enregistre (alerte): ${logError.message}`);
      }
    }
  }
}
