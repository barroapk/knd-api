export type MatchResult =
  | 'NO_MATCH'
  | 'UNIQUE_MATCH'
  | 'LATE_MATCH'
  | 'AMBIGUOUS_MATCH';

export interface MatchOutcome {
  result: MatchResult;
  matchedDepositId: string | null;
  lateMatchReason: 'after_cancel' | 'after_expiry' | 'ambiguous' | null;
}
