import { PUBLIC_COMMAND_NAMES } from "../../domain/command-surface";
import { type GameMode, resolveTwitchGameModePrefix } from "../../domain/game-mode";
import { REQUEST_OBJECTIVE_MAX_LENGTH } from "../../domain/help-request";
import {
  resolveTarkovMapPrefix,
  suggestTarkovMap,
  type TarkovMapDefinition,
} from "../../domain/maps/catalog";

export type PreparedTwitchCommand =
  | { name: "request"; gameMode: GameMode; map: TarkovMapDefinition; goal: string }
  | { name: "queue" };

type TwitchCommandPreparation =
  | { kind: "ignored" }
  | { kind: "guidance"; message: string }
  | { kind: "ready"; command: PreparedTwitchCommand };

const publicCommandPattern = new RegExp(
  String.raw`^!(${PUBLIC_COMMAND_NAMES.join("|")})(?:\s+(.+))?$`,
  "i",
);

function prepareRequest(input: string): TwitchCommandPreparation {
  const mode = resolveTwitchGameModePrefix(input);
  if (mode === undefined) {
    return {
      kind: "guidance",
      message: "Use !request [mode] [map] [goal]. Modes: seasonal, pvp, pve.",
    };
  }
  if (mode.remainingText.length === 0) {
    return { kind: "guidance", message: "Use !request [mode] [map] [goal]." };
  }
  const resolved = resolveTarkovMapPrefix(mode.remainingText);
  if (resolved === undefined) {
    const suggestion = suggestTarkovMap(mode.remainingText);
    return {
      kind: "guidance",
      message:
        suggestion === undefined
          ? "I do not know that map. Use !request [mode] [map] [goal]."
          : `Did you mean ${suggestion.name}? Try !request ${mode.mode} ${suggestion.id} [goal].`,
    };
  }
  const goal = resolved.remainingText || "General raid help";
  if (goal.length > REQUEST_OBJECTIVE_MAX_LENGTH) {
    return { kind: "guidance", message: "Keep the goal to 150 characters or fewer." };
  }
  return {
    kind: "ready",
    command: { name: "request", gameMode: mode.mode, map: resolved.map, goal },
  };
}

export function prepareTwitchPublicCommand(text: string): TwitchCommandPreparation {
  const trimmed = text.trim();
  const match = publicCommandPattern.exec(trimmed);
  if (match === null) return { kind: "ignored" };
  const name = match[1]?.toLowerCase();
  const argument = match[2];
  if (name === "request") {
    return prepareRequest(argument?.trim() ?? "");
  }
  return name === "queue" && argument === undefined
    ? { kind: "ready", command: { name } }
    : { kind: "ignored" };
}
