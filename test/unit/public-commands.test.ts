import { describe, expect, it } from "vitest";
import { parseTwitchPublicCommand } from "../../src/infrastructure/twitch/public-commands";
import { renderQueueFacts } from "../../src/presentation/public-responses";

describe("public commands", () => {
  it("parses only the two no-friction Twitch commands", () => {
    expect(parseTwitchPublicCommand("!request customs pocket watch")).toEqual({
      name: "request",
      rawText: "!request customs pocket watch",
      input: "customs pocket watch",
    });
    expect(parseTwitchPublicCommand("!queue")).toEqual({ name: "queue", rawText: "!queue" });
    expect(parseTwitchPublicCommand("!queue customs")).toBeUndefined();
    expect(parseTwitchPublicCommand("!position")).toBeUndefined();
  });

  it("shows only the caller's global position and raid estimate", () => {
    expect(
      renderQueueFacts(
        {
          caller: {
            mapName: "Customs",
            queuePosition: { kind: "exact", ordinal: 3 },
            raidsAhead: { kind: "exact", count: 2 },
            otherActiveMapNames: ["Woods"],
          },
        },
        "discord",
      ),
    ).toBe("3rd overall for Customs, 2 raids ahead. Also queued: Woods.");
  });

  it("reports capped request and raid prefixes independently", () => {
    expect(
      renderQueueFacts(
        {
          caller: {
            mapName: "Customs",
            queuePosition: { kind: "more_than", requestsAhead: 100 },
            raidsAhead: { kind: "more_than", count: 50 },
            otherActiveMapNames: [],
          },
        },
        "twitch",
      ),
    ).toBe("More than 100 requests ahead for Customs, more than 50 raids ahead.");
    expect(
      renderQueueFacts(
        {
          caller: {
            mapName: "Icebreaker",
            queuePosition: { kind: "exact", ordinal: 83 },
            raidsAhead: { kind: "more_than", count: 50 },
            otherActiveMapNames: [],
          },
        },
        "discord",
      ),
    ).toBe("83rd overall for Icebreaker, more than 50 raids ahead.");
  });

  it("guides an unmatched caller with the platform's request command", () => {
    expect(renderQueueFacts({}, "discord")).toBe("Use `/request` to join.");
    expect(renderQueueFacts({}, "twitch")).toBe("Use !request [map] [goal].");
  });
});
