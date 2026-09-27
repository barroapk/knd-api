import { Controller, Get, Query, BadRequestException } from '@nestjs/common';
import { NafaCashVerificationProvider } from './nafacash-verification.provider';

@Controller('player-verification')
export class PlayerVerificationController {
  constructor(private readonly nafaCashProvider: NafaCashVerificationProvider) {}

  @Get('verify')
  async verify(@Query('playerId') playerId: string) {
    if (!playerId) {
      throw new BadRequestException('Parametre playerId requis');
    }
    return this.nafaCashProvider.verifyPlayer(playerId);
  }
}
