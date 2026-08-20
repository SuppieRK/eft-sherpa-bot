import type { UserMapping } from "./sherpa-repository";

export const USER_DIRECTORY_PAGE_SIZE = 10;

export interface StaffUserDirectoryEntry extends UserMapping {
  twitchIdentityObserved: boolean;
}

export interface StaffUserDirectoryPage {
  entries: readonly StaffUserDirectoryEntry[];
  hasPrevious: boolean;
  hasNext: boolean;
}

export type UserDirectoryDirection = "first" | "at" | "next" | "previous";

export interface StaffUserDirectoryRepository {
  getUserDirectoryPage(input: {
    direction: UserDirectoryDirection;
    cursor?: string;
  }): Promise<StaffUserDirectoryPage>;
  findUserMappingByTwitchLogin(twitchLogin: string): Promise<StaffUserDirectoryEntry | undefined>;
  completeMissingDiscord(input: {
    twitchLogin: string;
    discordUserId: string;
    discordDisplayName?: string;
    changedAt: Date;
  }): Promise<"updated" | "stale">;
  completeMissingInGameName(input: {
    twitchLogin: string;
    inGameName: string;
    changedAt: Date;
  }): Promise<"updated" | "stale">;
}
