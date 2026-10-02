import { Module } from '@nestjs/common';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';
import { DepositLifecycleService } from './deposit-lifecycle.service';
import { PlayerVerificationModule } from '../player-verification/player-verification.module';

@Module({
  imports: [PlayerVerificationModule],
  controllers: [DepositsController],
  providers: [DepositsService, DepositLifecycleService],
  exports: [DepositLifecycleService],
})
export class DepositsModule {}
