export interface CreateCampaignDto {
  name: string;
  percentage: number;
  returningPercentage?: number | null;
  startsAt: string;
  endsAt: string;
  minDeposit?: number;
  maxBonus?: number | null;
}

export interface UpdateCampaignDto {
  name?: string;
  percentage?: number;
  returningPercentage?: number | null;
  startsAt?: string;
  endsAt?: string;
  minDeposit?: number;
  maxBonus?: number | null;
}
