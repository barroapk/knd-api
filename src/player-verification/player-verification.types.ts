export interface PlayerVerificationResult {
  valid: boolean;
  playerId: string;
  playerName?: string;
  provider: string;
}

export interface PlayerVerificationProvider {
  verifyPlayer(playerId: string): Promise<PlayerVerificationResult>;
}
