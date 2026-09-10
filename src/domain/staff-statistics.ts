export interface StaffLeaderStatistic {
  discordUserId: string;
  helpedRequests: number;
  successfulRaids: number;
}

export interface StaffStatistics {
  submittedRequests: number;
  helpedRequests: number;
  openRequests: number;
  canceledRequests: number;
  successfulRaids: number;
  leaders: readonly StaffLeaderStatistic[];
  omittedLeaderCount: number;
}

export interface StaffStatisticsRepository {
  getStaffStatistics(): Promise<StaffStatistics>;
}
