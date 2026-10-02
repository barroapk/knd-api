export interface CreateDepositDto {
  playerId: string;
  amount: number;
  paymentPhone: string;
}

export interface PreviewDepositDto {
  playerId: string;
  amount: number;
}
