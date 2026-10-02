import { Module } from '@nestjs/common';
import { ManagerController } from './manager.controller';
import { ManagerService } from './manager.service';
import { AuthModule } from '../auth/auth.module';
import { DepositsModule } from '../deposits/deposits.module';

@Module({
  imports: [AuthModule, DepositsModule],
  controllers: [ManagerController],
  providers: [ManagerService],
})
export class ManagerModule {}
