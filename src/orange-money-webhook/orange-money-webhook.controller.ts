import { Controller, Post, Body, Headers, UnauthorizedException, Logger } from '@nestjs/common';
import { parseOrangeMoneyReceptionSms } from './orange-money-sms.parser';

@Controller('webhooks/orange-money-sms')
export class OrangeMoneyWebhookController {
  private readonly logger = new Logger(OrangeMoneyWebhookController.name);

  @Post()
  async receiveSms(
    @Body('smsText') smsText: string,
    @Headers('x-webhook-secret') secret: string,
  ) {
    if (secret !== process.env.SMS_WEBHOOK_SECRET) {
      throw new UnauthorizedException('Cle webhook invalide');
    }

    const parsed = parseOrangeMoneyReceptionSms(smsText);

    if (!parsed) {
      this.logger.warn(`SMS non reconnu par le parseur: ${smsText}`);
      return { matched: false, reason: 'format_non_reconnu' };
    }

    this.logger.log(
      `SMS parse: montant=${parsed.amount} expediteur=${parsed.senderPhone} ref=${parsed.transactionId}`,
    );

    // TODO Brique suivante : chercher un deposit en PAYMENT_DECLARED avec
    // amount + declared_payment_phone correspondants, idempotence sur
    // transactionId (jamais confirmer deux fois le meme SMS).

    return { matched: true, parsed };
  }
}
