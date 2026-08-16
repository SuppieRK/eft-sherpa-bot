export type RequestState = "waiting" | "planned" | "completed" | "canceled";
type Platform = "discord" | "twitch";

interface HelpRequestRecord {
  id: number;
  reference: string;
  queueSequence: number;
  state: RequestState;
}

export interface CreateHelpRequest {
  sourcePlatform: Platform;
  sourceDeliveryId: string;
  discordUserId?: string;
  discordDisplayName?: string;
  twitchUserId?: string;
  twitchLogin: string;
  inGameName: string;
  mapId: string;
  objective: string;
  notes?: string;
  observedAt: Date;
}

export type CreateHelpRequestOutcome =
  | { outcome: "created"; request: HelpRequestRecord }
  | { outcome: "duplicate_delivery"; request: HelpRequestRecord }
  | { outcome: "already_active"; request: HelpRequestRecord };

export interface UserMapping {
  twitchLogin: string;
  twitchUserId?: string;
  discordUserId?: string;
  discordDisplayName?: string;
  inGameName?: string;
}

export class RepositoryInvariantError extends Error {
  override readonly name = "RepositoryInvariantError";
}
