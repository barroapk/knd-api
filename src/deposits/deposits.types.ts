export interface CreateDepositDto {
  playerId: string;
  amount: number;
  paymentPhone: string;
}

export interface PreviewDepositDto {
  playerId: string;
  amount: number;
}

export interface BonusInfoDto {
  playerId: string;
  amount: number;
}
