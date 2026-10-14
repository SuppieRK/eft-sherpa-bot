type RaidGroupState = "planned" | "active" | "completed" | "canceled";
export type CallStatus = "pending" | "sent" | "failed" | "not_requested";
export const BOARD_PAGE_SIZE = 10;

interface BoardPageCursor {
  lane: 0 | 1;
  key: number;
  id: number;
}

export interface BoardPageTarget {
  direction: "previous" | "next";
  boundary: BoardPageCursor;
  pageNumber: number;
}

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
  gameMode: GameMode;
  id: number;
  mapId: string;
  state: RaidGroupState;
  outcome?: "helped" | "not_run";
  requesterCapacity: number;
  sortKey: number;
  manualOrder: number;
  serviceLane: 0 | 1;
  serviceKey: number;
  leaderDiscordUserId?: string;
  leaderType?: "streamer" | "volunteer";
  automaticFill: boolean;
  startedAt?: number;
  discordCallStatus: CallStatus;
  twitchCallStatus: CallStatus;
  staffMessageId?: string;
  nextMoveRaidId?: number;
  members: StaffBoardMember[];
}

export interface StaffBoardSnapshot {
  boardVersion?: number;
  raidCount: number;
  pageNumber: number;
  previousPage?: BoardPageTarget;
  nextPage?: BoardPageTarget;
  canonicalMessageId?: string;
  raids: StaffBoardRaid[];
}

export interface PullRequesterSource extends StaffBoardRaid {
  previousSourceId?: number;
  nextSourceId?: number;
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

import type { GameMode } from "./game-mode";
