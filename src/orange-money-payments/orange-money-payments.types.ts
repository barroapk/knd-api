export interface ReceivePaymentDto {
  amount: number;
  senderPhone: string;
  senderName?: string;
  newBalance?: number;
  transactionId: string;
  receivedAt: string;
}

export interface ReceivePaymentResult {
  accepted: boolean;
  duplicate: boolean;
  transactionId: string;
  status: 'RECEIVED' | 'ALREADY_RECEIVED';
}
