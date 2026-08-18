import { resolveTarkovMapPrefix, suggestTarkovMap, type TarkovMapDefinition } from "./maps/catalog";
import { REQUEST_OBJECTIVE_MAX_LENGTH } from "./help-request";
import { resolveTwitchGameModePrefix, type GameMode } from "./game-mode";

export const TWITCH_REQUEST_DEFAULT_GOAL = "General raid help";

export type TwitchRequestInput =
  | { valid: true; gameMode: GameMode; map: TarkovMapDefinition; goal: string }
  | {
      valid: false;
      reason: "missing_mode" | "unknown_mode" | "missing_map" | "unknown_map" | "goal_too_long";
      gameMode?: GameMode;
      suggestion?: TarkovMapDefinition;
    };

export function parseTwitchRequestInput(value: string): TwitchRequestInput {
  if (value.trim().length === 0) {
    return { valid: false, reason: "missing_mode" };
  }
  const mode = resolveTwitchGameModePrefix(value);
  if (mode === undefined) {
    return { valid: false, reason: "unknown_mode" };
  }
  if (mode.remainingText.length === 0) {
    return { valid: false, reason: "missing_map", gameMode: mode.mode };
  }
  const resolved = resolveTarkovMapPrefix(mode.remainingText);
  if (resolved === undefined) {
    const suggestion = suggestTarkovMap(mode.remainingText);
    return {
      valid: false,
      reason: "unknown_map",
      gameMode: mode.mode,
      ...(suggestion === undefined ? {} : { suggestion }),
    };
  }
  const goal = resolved.remainingText || TWITCH_REQUEST_DEFAULT_GOAL;
  if (goal.length > REQUEST_OBJECTIVE_MAX_LENGTH) {
    return { valid: false, reason: "goal_too_long", gameMode: mode.mode };
  }
  return {
    valid: true,
    gameMode: mode.mode,
    map: resolved.map,
    goal,
  };
}
