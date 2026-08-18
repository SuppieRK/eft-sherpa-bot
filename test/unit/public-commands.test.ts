import { describe, expect, it } from "vitest";
import { parseTwitchPublicCommand } from "../../src/infrastructure/twitch/public-commands";
import { renderQueueFacts } from "../../src/presentation/public-responses";

describe("public commands", () => {
  it("parses only the two no-friction Twitch commands", () => {
    expect(parseTwitchPublicCommand("!request pve customs pocket watch")).toEqual({
      name: "request",
      rawText: "!request pve customs pocket watch",
      input: "pve customs pocket watch",
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
            gameMode: "pve",
            mapName: "Customs",
            queuePosition: { kind: "exact", ordinal: 3 },
            raidsAhead: { kind: "exact", count: 2 },
            otherActiveModeMapNames: ["PvP · Woods"],
          },
        },
        "discord",
      ),
    ).toBe("PvE · Customs: 3rd in the PvE queue, 2 raids ahead. Also queued: PvP · Woods.");
  });

  it("reports capped request and raid prefixes independently", () => {
    expect(
      renderQueueFacts(
        {
          caller: {
            gameMode: "pvp-seasonal",
            mapName: "Customs",
            queuePosition: { kind: "more_than", requestsAhead: 100 },
            raidsAhead: { kind: "more_than", count: 50 },
            otherActiveModeMapNames: [],
          },
        },
        "twitch",
      ),
    ).toBe(
      "PvP Seasonal · Customs: More than 100 requests ahead in this mode, more than 50 raids ahead.",
    );
    expect(
      renderQueueFacts(
        {
          caller: {
            gameMode: "pvp",
            mapName: "Icebreaker",
            queuePosition: { kind: "exact", ordinal: 83 },
            raidsAhead: { kind: "more_than", count: 50 },
            otherActiveModeMapNames: [],
          },
        },
        "discord",
      ),
    ).toBe("PvP · Icebreaker: 83rd in the PvP queue, more than 50 raids ahead.");
  });

  it("guides an unmatched caller with the platform's request command", () => {
    expect(renderQueueFacts({}, "discord")).toBe("Use `/request` to join.");
    expect(renderQueueFacts({}, "twitch")).toBe("Use !request [mode] [map] [goal].");
  });
});
