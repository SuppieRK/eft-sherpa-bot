import { formatModeMap, gameModeLabel } from "../domain/game-mode";
import type { QueueFacts } from "../domain/queue-queries";

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
  let ahead: string;
  if (facts.caller.raidsAhead.kind === "more_than") {
    ahead = `more than ${facts.caller.raidsAhead.count} raids ahead`;
  } else if (facts.caller.raidsAhead.count === 0) {
    ahead = "no raids ahead";
  } else {
    ahead = `${plural(facts.caller.raidsAhead.count, "raid")} ahead`;
  }
  const other =
    facts.caller.otherActiveModeMapNames.length === 0
      ? ""
      : ` Also queued: ${facts.caller.otherActiveModeMapNames.join(", ")}.`;
  const raidName = formatModeMap(facts.caller.gameMode, facts.caller.mapName);
  const position =
    facts.caller.queuePosition.kind === "more_than"
      ? `${raidName}: More than ${facts.caller.queuePosition.requestsAhead} requests ahead in this mode`
      : `${raidName}: ${ordinal(facts.caller.queuePosition.ordinal)} in the ${gameModeLabel(facts.caller.gameMode)} queue`;
  const primary = `${position}, ${ahead}.`;
  if (platform === "discord" || primary.length + other.length <= 500) return primary + other;
  let additional = "";
  let included = 0;
  const names = facts.caller.otherActiveModeMapNames;
  for (const name of names) {
    const candidate = additional + (included === 0 ? " Also queued: " : ", ") + name;
    const remaining = names.length - included - 1;
    if (primary.length + candidate.length + `; ${remaining} more.`.length > 500) break;
    additional = candidate;
    included++;
  }
  return `${primary}${additional}; ${names.length - included} more.`;
}
