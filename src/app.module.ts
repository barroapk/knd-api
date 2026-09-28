import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PlayerVerificationModule } from './player-verification/player-verification.module';
import { OrangeMoneyWebhookModule } from './orange-money-webhook/orange-money-webhook.module';
import { SupabaseModule } from './supabase/supabase.module';
import { AuthModule } from './auth/auth.module';
import { AdminModule } from './admin/admin.module';
import { DevicesModule } from './devices/devices.module';
import { OrangeMoneyPaymentsModule } from './orange-money-payments/orange-money-payments.module';
import { MatchingModule } from './matching/matching.module';
import { DepositsModule } from './deposits/deposits.module';
import { ManagerModule } from './manager/manager.module';
import { BonusModule } from './bonus/bonus.module';

@Module({
  imports: [
    PlayerVerificationModule,
    OrangeMoneyWebhookModule,
    SupabaseModule,
    AuthModule,
    AdminModule,
    DevicesModule,
    OrangeMoneyPaymentsModule,
    MatchingModule,
    DepositsModule,
    ManagerModule,
    BonusModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
