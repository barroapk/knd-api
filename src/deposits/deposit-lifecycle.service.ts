import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

const LATE_AFTER_MINUTES = 3;
const EXPIRE_AFTER_MINUTES = 10;
const SWEEP_INTERVAL_MS = 30000;

/**
 * Fait avancer les depots dans le temps. Le plan gratuit de Render endort
 * le serveur : le minuteur ne suffit donc pas, sweepSafely() est aussi
 * appele a chaque creation/lecture de depot.
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
    const expireCutoff = new Date(now.getTime() - EXPIRE_AFTER_MINUTES * 60 * 1000).toISOString();
    const lateCutoff = new Date(now.getTime() - LATE_AFTER_MINUTES * 60 * 1000).toISOString();

    // D'abord l'expiration, puis le passage en retard.
    await this.transition(['PAYMENT_PENDING', 'PAYMENT_LATE'], 'PAYMENT_EXPIRED', expireCutoff, 'DEPOSIT_EXPIRED');
    await this.transition(['PAYMENT_PENDING'], 'PAYMENT_LATE', lateCutoff, 'DEPOSIT_LATE');
  }

  private async transition(from: string[], to: string, cutoffIso: string, action: string) {
    // Mise a jour conditionnelle : ne touche jamais un depot deja confirme.
    const { data, error } = await this.supabase.client
      .from('deposits')
      .update({ status: to })
      .in('status', from)
      .lt('created_at', cutoffIso)
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
}
