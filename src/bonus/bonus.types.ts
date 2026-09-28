export interface CreateCampaignDto {
  name: string;
  percentage: number;
  startsAt: string;
  endsAt: string;
  minDeposit?: number;
  maxBonus?: number | null;
}
