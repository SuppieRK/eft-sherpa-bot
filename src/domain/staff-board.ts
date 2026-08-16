type RaidGroupState = "planned" | "active" | "completed" | "canceled";
export type CallStatus = "pending" | "sent" | "failed" | "not_requested";
export type QueueKind = "ordinary" | "priority";

export interface StaffBoardMember {
  id: number;
  requestId: number;
  twitchLogin: string;
  inGameName: string;
  discordUserId?: string;
  objective: string;
  notes?: string;
  position: number;
}

export interface StaffBoardRaid {
  id: number;
  queueKind: QueueKind;
  mapId: string;
  state: RaidGroupState;
  outcome?: "helped" | "not_run";
  requesterCapacity: number;
  leaderDiscordUserId?: string;
  leaderType?: "streamer" | "volunteer";
  automaticFill: boolean;
  attemptCount: number;
  discordCallStatus: CallStatus;
  twitchCallStatus: CallStatus;
  staffMessageId?: string;
  members: StaffBoardMember[];
}

export interface StaffBoardSnapshot {
  priorityRaidCount: number;
  ordinaryRaidCount: number;
  canonicalMessageId?: string;
  priorityRaids: StaffBoardRaid[];
  ordinaryRaids: StaffBoardRaid[];
}

export function isStaffBoardMember(input: {
  discordUserId: string;
  discordRoleIds: readonly string[];
  streamerDiscordUserId: string;
  volunteerRoleId: string;
}): boolean {
  return (
    input.discordUserId === input.streamerDiscordUserId ||
    input.discordRoleIds.includes(input.volunteerRoleId)
  );
}
