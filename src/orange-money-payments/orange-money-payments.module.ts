import { Module } from '@nestjs/common';
import { OrangeMoneyPaymentsController } from './orange-money-payments.controller';
import { OrangeMoneyPaymentsService } from './orange-money-payments.service';
import { DeviceTokenGuard } from './device-token.guard';
import { DevicesModule } from '../devices/devices.module';
import { MatchingModule } from '../matching/matching.module';

@Module({
  imports: [DevicesModule, MatchingModule],
  controllers: [OrangeMoneyPaymentsController],
  providers: [OrangeMoneyPaymentsService, DeviceTokenGuard],
})
export class OrangeMoneyPaymentsModule {}
