import { PUBLIC_COMMAND_NAMES } from "../../domain/command-surface";

export type TwitchPublicCommand =
  | { name: "request"; rawText: string; input: string }
  | { name: "queue"; rawText: string };

const publicCommandPattern = new RegExp(`^!(${PUBLIC_COMMAND_NAMES.join("|")})(?:\\s+(.+))?$`, "i");

export function parseTwitchPublicCommand(text: string): TwitchPublicCommand | undefined {
  const trimmed = text.trim();
  const match = publicCommandPattern.exec(trimmed);
  if (match === null) return undefined;
  const name = match[1]?.toLowerCase();
  const argument = match[2];
  if (name === "request") {
    return { name, rawText: trimmed, input: argument?.trim() ?? "" };
  }
  return name === "queue" && argument === undefined ? { name, rawText: trimmed } : undefined;
}
