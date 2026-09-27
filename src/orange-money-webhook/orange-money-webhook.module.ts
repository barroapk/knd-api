import { Module } from '@nestjs/common';
import { OrangeMoneyWebhookController } from './orange-money-webhook.controller';

@Module({
  controllers: [OrangeMoneyWebhookController],
})
export class OrangeMoneyWebhookModule {}
