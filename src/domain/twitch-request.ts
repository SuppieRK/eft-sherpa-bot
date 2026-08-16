import { resolveTarkovMapPrefix, suggestTarkovMap, type TarkovMapDefinition } from "./maps/catalog";
import { REQUEST_OBJECTIVE_MAX_LENGTH } from "./help-request";

export const TWITCH_REQUEST_DEFAULT_GOAL = "General raid help";

export type TwitchRequestInput =
  | { valid: true; map: TarkovMapDefinition; goal: string }
  | {
      valid: false;
      reason: "missing_map" | "unknown_map" | "goal_too_long";
      suggestion?: TarkovMapDefinition;
    };

export function parseTwitchRequestInput(value: string): TwitchRequestInput {
  if (value.trim().length === 0) {
    return { valid: false, reason: "missing_map" };
  }
  const resolved = resolveTarkovMapPrefix(value);
  if (resolved === undefined) {
    const suggestion = suggestTarkovMap(value);
    return {
      valid: false,
      reason: "unknown_map",
      ...(suggestion === undefined ? {} : { suggestion }),
    };
  }
  const goal = resolved.remainingText || TWITCH_REQUEST_DEFAULT_GOAL;
  if (goal.length > REQUEST_OBJECTIVE_MAX_LENGTH) {
    return { valid: false, reason: "goal_too_long" };
  }
  return {
    valid: true,
    map: resolved.map,
    goal,
  };
}
