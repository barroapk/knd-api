import { Module } from '@nestjs/common';
import { NafaCashVerificationProvider } from './nafacash-verification.provider';
import { PlayerVerificationController } from './player-verification.controller';

@Module({
  controllers: [PlayerVerificationController],
  providers: [NafaCashVerificationProvider],
  exports: [NafaCashVerificationProvider],
})
export class PlayerVerificationModule {}
