import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MatchOutcome } from './matching.types';

const NORMAL_STATUSES = ['PAYMENT_PENDING', 'PAYMENT_LATE', 'PAYMENT_REVIEW'];
const LATE_STATUSES = ['CANCELLED', 'PAYMENT_EXPIRED'];
const LATE_WINDOW_HOURS = 2;

@Injectable()
export class MatchingService {
  private readonly logger = new Logger(MatchingService.name);

  constructor(private readonly supabase: SupabaseService) {}

  async matchPayment(paymentId: string): Promise<MatchOutcome> {
    const { data: payment, error } = await this.supabase.client
      .from('orange_money_payments')
      .select('id, amount, sender_phone, received_at')
      .eq('id', paymentId)
      .single();

    if (error || !payment) {
      throw new Error(`Paiement introuvable pour matching: ${paymentId}`);
    }

    const normalCandidates = await this.findNormalCandidates(payment.sender_phone, payment.amount);

    if (normalCandidates.length === 1) {
      return this.applyUniqueMatch(paymentId, normalCandidates[0].id);
    }

    if (normalCandidates.length > 1) {
      this.logger.warn(
        `ANOMALIE: ${normalCandidates.length} depots actifs trouves pour phone=${payment.sender_phone} amount=${payment.amount} - contrainte SQL potentiellement contournee`,
      );
      return this.applyAmbiguous(paymentId);
    }

    const lateCandidates = await this.findLateCandidates(
      payment.sender_phone,
      payment.amount,
      payment.received_at,
    );

    if (lateCandidates.length === 0) {
      return this.applyNoMatch(paymentId);
    }

    if (lateCandidates.length > 1) {
      return this.applyAmbiguous(paymentId);
    }

    const lateDeposit = lateCandidates[0];
    const reason = lateDeposit.status === 'CANCELLED' ? 'after_cancel' : 'after_expiry';
    return this.applyLateMatch(paymentId, lateDeposit.id, reason);
  }

  private async findNormalCandidates(senderPhone: string, amount: number) {
    const { data, error } = await this.supabase.client
      .from('deposits')
      .select('id, status')
      .eq('declared_payment_phone', senderPhone)
      .eq('amount', amount)
      .in('status', NORMAL_STATUSES)
      .is('matched_payment_id', null);

    if (error) {
      throw new Error(`Erreur recherche candidats normaux: ${error.message}`);
    }

    return data ?? [];
  }

  private async findLateCandidates(senderPhone: string, amount: number, receivedAt: string) {
    const windowStart = new Date(
      new Date(receivedAt).getTime() - LATE_WINDOW_HOURS * 60 * 60 * 1000,
    ).toISOString();

    const { data, error } = await this.supabase.client
      .from('deposits')
      .select('id, status')
      .eq('declared_payment_phone', senderPhone)
      .eq('amount', amount)
      .in('status', LATE_STATUSES)
      .gte('updated_at', windowStart)
      .is('matched_payment_id', null);

    if (error) {
      throw new Error(`Erreur recherche candidats tardifs: ${error.message}`);
    }

    return data ?? [];
  }

  /**
   * Sequence d'ecriture en 3 etapes, chacune verifiee explicitement.
   * Si une etape echoue apres que la precedente ait reussi, l'etat peut
   * rester incoherent (V1 : pas de transaction multi-tables via Supabase
   * REST) - on logge alors une erreur explicite pour investigation
   * manuelle plutot que de faire semblant que tout est coherent.
   */
  private async applyUniqueMatch(paymentId: string, depositId: string): Promise<MatchOutcome> {
    const { data: updatedDeposit, error: depositError } = await this.supabase.client
      .from('deposits')
      .update({ status: 'PAYMENT_CONFIRMED' })
      .eq('id', depositId)
      .in('status', NORMAL_STATUSES)
      .select('id, player_id_1xbet, amount')
      .maybeSingle();

    if (depositError) {
      throw new Error(`Erreur confirmation depot: ${depositError.message}`);
    }

    if (!updatedDeposit) {
      this.logger.warn(`Course detectee sur depot ${depositId} - traite comme ambigu`);
      return this.applyAmbiguous(paymentId);
    }

    // Compte commercial : execute uniquement ici, jamais rejouable, car la
    // clause .in(status, NORMAL_STATUSES) ci-dessus garantit que ce code
    // n'est atteint qu'une seule fois par depot (un match rejoue trouverait
    // le depot deja hors NORMAL_STATUSES et sortirait plus haut).
    await this.recordPlayerDeposit(updatedDeposit.player_id_1xbet, Number(updatedDeposit.amount));

    const { error: paymentUpdateError } = await this.supabase.client
      .from('orange_money_payments')
      .update({ status: 'MATCHED', matched_deposit_id: depositId })
      .eq('id', paymentId);

    if (paymentUpdateError) {
      this.logger.error(
        `INCOHERENCE: depot ${depositId} passe a PAYMENT_CONFIRMED mais echec mise a jour payment ${paymentId}: ${paymentUpdateError.message}`,
      );
      throw new Error(`Erreur mise a jour paiement apres match: ${paymentUpdateError.message}`);
    }

    const { error: depositLinkError } = await this.supabase.client
      .from('deposits')
      .update({ matched_payment_id: paymentId })
      .eq('id', depositId);

    if (depositLinkError) {
      this.logger.error(
        `INCOHERENCE: payment ${paymentId} marque MATCHED mais echec liaison retour sur depot ${depositId}: ${depositLinkError.message}`,
      );
      throw new Error(`Erreur liaison depot apres match: ${depositLinkError.message}`);
    }

    return { result: 'UNIQUE_MATCH', matchedDepositId: depositId, lateMatchReason: null };
  }

  /**
   * Met a jour le compteur commercial du joueur apres un depot reellement
   * CONFIRME (jamais a la creation). first_deposit_at n'est pose que s'il
   * etait encore vide, pour ne jamais ecraser une vraie premiere date.
   */
  private async recordPlayerDeposit(playerId: string, amount: number) {
    const { data: player, error: readError } = await this.supabase.client
      .from('players_verified')
      .select('deposit_count, total_deposited, first_deposit_at')
      .eq('player_id_1xbet', playerId)
      .maybeSingle();

    if (readError || !player) {
      this.logger.warn(`Compteur joueur non mis a jour (lecture): ${readError?.message ?? 'joueur introuvable'}`);
      return;
    }

    const { error: updateError } = await this.supabase.client
      .from('players_verified')
      .update({
        deposit_count: Number(player.deposit_count ?? 0) + 1,
        total_deposited: Number(player.total_deposited ?? 0) + amount,
        first_deposit_at: player.first_deposit_at ?? new Date().toISOString(),
      })
      .eq('player_id_1xbet', playerId);

    if (updateError) {
      this.logger.warn(`Compteur joueur non mis a jour (ecriture): ${updateError.message}`);
    }
  }

  private async applyLateMatch(
    paymentId: string,
    depositId: string,
    reason: 'after_cancel' | 'after_expiry',
  ): Promise<MatchOutcome> {
    const { error } = await this.supabase.client
      .from('orange_money_payments')
      .update({
        status: 'UNMATCHED',
        matched_deposit_id: depositId,
        late_match_reason: reason,
      })
      .eq('id', paymentId);

    if (error) {
      throw new Error(`Erreur enregistrement match tardif: ${error.message}`);
    }

    return { result: 'LATE_MATCH', matchedDepositId: depositId, lateMatchReason: reason };
  }

  private async applyNoMatch(paymentId: string): Promise<MatchOutcome> {
    const { error } = await this.supabase.client
      .from('orange_money_payments')
      .update({ status: 'UNMATCHED' })
      .eq('id', paymentId);

    if (error) {
      throw new Error(`Erreur enregistrement no-match: ${error.message}`);
    }

    return { result: 'NO_MATCH', matchedDepositId: null, lateMatchReason: null };
  }

  private async applyAmbiguous(paymentId: string): Promise<MatchOutcome> {
    const { error } = await this.supabase.client
      .from('orange_money_payments')
      .update({ status: 'UNMATCHED', late_match_reason: 'ambiguous' })
      .eq('id', paymentId);

    if (error) {
      throw new Error(`Erreur enregistrement ambiguous: ${error.message}`);
    }

    return { result: 'AMBIGUOUS_MATCH', matchedDepositId: null, lateMatchReason: 'ambiguous' };
  }
}
