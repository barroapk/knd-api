import { Injectable, BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';
import { MatchingService } from '../matching/matching.service';
import { ReceivePaymentDto, ReceivePaymentResult } from './orange-money-payments.types';

// Code postgres pour "unique_violation" - declenche quand la contrainte
// UNIQUE sur transaction_id est violee (insertion concurrente ou rejeu).
const POSTGRES_UNIQUE_VIOLATION = '23505';

@Injectable()
export class OrangeMoneyPaymentsService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly matchingService: MatchingService,
  ) {}

  async receivePayment(dto: ReceivePaymentDto, deviceId: string): Promise<ReceivePaymentResult> {
    this.validateDto(dto);

    const { data: insertedPayment, error } = await this.supabase.client
      .from('orange_money_payments')
      .insert({
        transaction_id: dto.transactionId,
        amount: dto.amount,
        sender_phone: dto.senderPhone,
        sender_name: dto.senderName ?? null,
        new_balance: dto.newBalance ?? null,
        received_at: dto.receivedAt,
        device_id: deviceId,
        status: 'RECEIVED',
      })
      .select('id')
      .single();

    if (error) {
      // Doublon : la contrainte UNIQUE a bloque l'insertion - c'est le
      // comportement attendu pour un retry KND-Tigui, pas une vraie erreur.
      if (error.code === POSTGRES_UNIQUE_VIOLATION) {
        return {
          accepted: true,
          duplicate: true,
          transactionId: dto.transactionId,
          status: 'ALREADY_RECEIVED',
        };
      }

      throw new Error(`Erreur enregistrement paiement: ${error.message}`);
    }

    if (!insertedPayment) {
      throw new Error('Paiement insere mais ID introuvable');
    }

    // Matching synchrone : uniquement pour un paiement reellement nouveau,
    // jamais pour un doublon deja traite precedemment.
    await this.matchingService.matchPayment(insertedPayment.id);

    return {
      accepted: true,
      duplicate: false,
      transactionId: dto.transactionId,
      status: 'RECEIVED',
    };
  }

  // Fenetre pensee pour un telephone KND-Tigui hors ligne (batterie morte,
  // zone sans reseau) qui rattrape sa synchronisation plus tard - pas pour
  // un flux temps reel strict.
  private static readonly MAX_PAST_HOURS = 72;
  private static readonly MAX_FUTURE_MINUTES = 5;

  private validateDto(dto: ReceivePaymentDto) {
    if (!dto.transactionId || dto.transactionId.trim() === '') {
      throw new BadRequestException('transactionId requis');
    }
    if (!dto.senderPhone || dto.senderPhone.trim() === '') {
      throw new BadRequestException('senderPhone requis');
    }
    if (typeof dto.amount !== 'number' || dto.amount <= 0) {
      throw new BadRequestException('amount invalide');
    }
    if (!dto.receivedAt || isNaN(Date.parse(dto.receivedAt))) {
      throw new BadRequestException('receivedAt invalide (format ISO attendu)');
    }

    const receivedAtMs = Date.parse(dto.receivedAt);
    const nowMs = Date.now();
    const maxPastMs = OrangeMoneyPaymentsService.MAX_PAST_HOURS * 60 * 60 * 1000;
    const maxFutureMs = OrangeMoneyPaymentsService.MAX_FUTURE_MINUTES * 60 * 1000;

    if (receivedAtMs < nowMs - maxPastMs) {
      throw new BadRequestException(
        `receivedAt trop ancien (plus de ${OrangeMoneyPaymentsService.MAX_PAST_HOURS}h) - a verifier manuellement si legitime`,
      );
    }
    if (receivedAtMs > nowMs + maxFutureMs) {
      throw new BadRequestException('receivedAt dans le futur - horloge du device suspecte');
    }
  }
}
