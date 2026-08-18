import type { QueueFacts } from "../domain/queue-queries";
import { formatModeMap, gameModeLabel } from "../domain/game-mode";

function plural(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function ordinal(value: number): string {
  const remainder = value % 100;
  if (remainder >= 11 && remainder <= 13) return `${value}th`;
  switch (value % 10) {
    case 1:
      return `${value}st`;
    case 2:
      return `${value}nd`;
    case 3:
      return `${value}rd`;
    default:
      return `${value}th`;
  }
}

export function renderQueueFacts(facts: QueueFacts, platform: "discord" | "twitch"): string {
  if (facts.caller === undefined) {
    return platform === "discord" ? "Use `/request` to join." : "Use !request [mode] [map] [goal].";
  }
  const ahead =
    facts.caller.raidsAhead.kind === "more_than"
      ? `more than ${facts.caller.raidsAhead.count} raids ahead`
      : facts.caller.raidsAhead.count === 0
        ? "no raids ahead"
        : `${plural(facts.caller.raidsAhead.count, "raid")} ahead`;
  const other =
    facts.caller.otherActiveModeMapNames.length === 0
      ? ""
      : ` Also queued: ${facts.caller.otherActiveModeMapNames.join(", ")}.`;
  const raidName = formatModeMap(facts.caller.gameMode, facts.caller.mapName);
  const position =
    facts.caller.queuePosition.kind === "more_than"
      ? `${raidName}: More than ${facts.caller.queuePosition.requestsAhead} requests ahead in this mode`
      : `${raidName}: ${ordinal(facts.caller.queuePosition.ordinal)} in the ${gameModeLabel(facts.caller.gameMode)} queue`;
  return `${position}, ${ahead}.${other}`;
}
