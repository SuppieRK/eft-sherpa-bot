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
  gameMode: GameMode;
  inGameName: string;
  mapId: string;
  objective: string;
  notes?: string;
  recipientLimit: number;
  observedAt: Date;
}

export type CreateHelpRequestOutcome =
  | { outcome: "created"; queueChanged: true; request: HelpRequestRecord }
  | { outcome: "duplicate_delivery"; queueChanged: boolean; request: HelpRequestRecord }
  | { outcome: "already_active"; queueChanged: false; request: HelpRequestRecord };

export interface UserMapping {
  twitchLogin: string;
  twitchUserId?: string;
  discordUserId?: string;
  discordDisplayName?: string;
  inGameName?: string;
}

export class RepositoryInvariantError extends Error {
  override readonly name: string = "RepositoryInvariantError";
}

export class StableTwitchIdentityConflictError extends RepositoryInvariantError {
  override readonly name = "StableTwitchIdentityConflictError";
}
import type { GameMode } from "./game-mode";
