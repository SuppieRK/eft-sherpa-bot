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
    return platform === "discord" ? "Use `/request` to join." : "Use !request [map] [goal].";
  }
  const ahead =
    facts.caller.raidsAhead.kind === "more_than"
      ? `more than ${facts.caller.raidsAhead.count} raids ahead`
      : facts.caller.raidsAhead.count === 0
        ? "no raids ahead"
        : `${plural(facts.caller.raidsAhead.count, "raid")} ahead`;
  const other =
    facts.caller.otherActiveMapNames.length === 0
      ? ""
      : ` Also queued: ${facts.caller.otherActiveMapNames.join(", ")}.`;
  const position =
    facts.caller.queuePosition.kind === "more_than"
      ? `More than ${facts.caller.queuePosition.requestsAhead} requests ahead for ${facts.caller.mapName}`
      : `${ordinal(facts.caller.queuePosition.ordinal)} overall for ${facts.caller.mapName}`;
  return `${position}, ${ahead}.${other}`;
}
