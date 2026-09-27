import { Injectable, Logger } from '@nestjs/common';
import { PlayerVerificationProvider, PlayerVerificationResult } from './player-verification.types';

@Injectable()
export class NafaCashVerificationProvider implements PlayerVerificationProvider {
  private readonly logger = new Logger(NafaCashVerificationProvider.name);
  private readonly baseUrl = process.env.NAFACASH_API_URL;
  private readonly platformId = process.env.NAFACASH_PLATFORM_ID_1XBET;
  private readonly apiKey = process.env.NAFACASH_API_KEY;

  async verifyPlayer(playerId: string): Promise<PlayerVerificationResult> {
    if (!this.baseUrl || !this.platformId) {
      throw new Error('Configuration NafaCash manquante (NAFACASH_API_URL / NAFACASH_PLATFORM_ID_1XBET)');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (this.apiKey) {
      headers['Authorization'] = `Bearer ${this.apiKey}`;
    }

    try {
      const response = await fetch(`${this.baseUrl}/api/transactions/verify-player`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          platformId: this.platformId,
          playerId,
        }),
      });

      if (!response.ok) {
        this.logger.warn(`NafaCash verify-player HTTP ${response.status} pour playerId=${playerId}`);
        return { valid: false, playerId, provider: 'nafacash' };
      }

      const data = await response.json();

      return {
        valid: Boolean(data.valid),
        playerId: data.playerId ?? playerId,
        playerName: data.playerName,
        provider: 'nafacash',
      };
    } catch (error) {
      this.logger.error(`Erreur verification NafaCash pour playerId=${playerId}: ${error.message}`);
      throw new Error('Service de verification temporairement indisponible');
    }
  }
}
