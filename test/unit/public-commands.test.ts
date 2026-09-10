import { describe, expect, it } from "vitest";
import { prepareTwitchPublicCommand } from "../../src/infrastructure/twitch/public-commands";
import { renderQueueFacts } from "../../src/presentation/public-responses";

describe("public commands", () => {
  it.each(["!queue", "  !QUEUE  "])("prepares %s without raw text", (text) => {
    expect(prepareTwitchPublicCommand(text)).toEqual({ kind: "ready", command: { name: "queue" } });
  });

  it.each([
    "",
    "ordinary chat",
    "!requester",
    "!queue customs",
    "!position",
    "!stats",
    "!users",
    "!request pve customs first\nsecond",
  ])("ignores %s", (text) => {
    expect(prepareTwitchPublicCommand(text)).toEqual({ kind: "ignored" });
  });

  it.each([
    ["!request pve customs pocket watch", "pve", "customs", "pocket watch"],
    ["!request pve customs", "pve", "customs", "General raid help"],
    ["!request pvp Ground-Zero Saving the Mole", "pvp", "ground-zero", "Saving the Mole"],
    ["  !REQUEST  PvE\tbig red\tMy Goal  ", "pve", "customs", "My Goal"],
    ["!request pvp seasonal streets Help", "pvp-seasonal", "streets-of-tarkov", "Help"],
    ["!request pvp-seasonal customs task help", "pvp-seasonal", "customs", "task help"],
    ["!request seasonal customs task help", "pvp-seasonal", "customs", "task help"],
    [`!request pve customs ${"x".repeat(150)}`, "pve", "customs", "x".repeat(150)],
  ])("prepares complete request %s", (text, gameMode, mapId, goal) => {
    const prepared = prepareTwitchPublicCommand(text);
    expect(prepared).toMatchObject({
      kind: "ready",
      command: { name: "request", gameMode, map: { id: mapId }, goal },
    });
    if (prepared.kind !== "ready") throw new Error("Expected a prepared command");
    expect(prepared.command).not.toHaveProperty("rawText");
    expect(prepared.command).not.toHaveProperty("input");
  });

  it.each([
    ["!request", "Use !request [mode] [map] [goal]. Modes: seasonal, pvp, pve."],
    ["!request customs task", "Use !request [mode] [map] [goal]. Modes: seasonal, pvp, pve."],
    ["!request pve", "Use !request [mode] [map] [goal]."],
    ["!request pve somewhere task", "I do not know that map. Use !request [mode] [map] [goal]."],
    ["!request pve custms pocket watch", "Did you mean Customs? Try !request pve customs [goal]."],
    [
      "!request seasonal custms pocket watch",
      "Did you mean Customs? Try !request pvp-seasonal customs [goal].",
    ],
    [`!request pve customs ${"x".repeat(151)}`, "Keep the goal to 150 characters or fewer."],
  ])("returns guidance rather than an executable command for %s", (text, message) => {
    expect(prepareTwitchPublicCommand(text)).toEqual({ kind: "guidance", message });
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
