import { Module } from '@nestjs/common';
import { DepositsController } from './deposits.controller';
import { DepositsService } from './deposits.service';
import { PlayerVerificationModule } from '../player-verification/player-verification.module';

@Module({
  imports: [PlayerVerificationModule],
  controllers: [DepositsController],
  providers: [DepositsService],
})
export class DepositsModule {}
