import { describe, expect, it } from "vitest";
import { resolveTarkovMap } from "../../src/domain/maps/catalog";
import { appendRaidBringSuffix } from "../../src/domain/raid-call";

const restrictedMaps = [
  ["the-lab", "TerraGroup Labs access keycard"],
  ["the-labyrinth", "Labrys access keycard"],
  ["terminal", "Prapor's letter for the port checkpoint"],
  ["icebreaker", "current Euro exit fee"],
] as const;

function messagesFor(mapId: string, mode = "PvE") {
  const map = resolveTarkovMap(mapId);
  const raidName = `${mode} · ${map?.name ?? mapId}`;
  return {
    discord: appendRaidBringSuffix(`Starting ${raidName}: <@viewer>`, map),
    twitch: appendRaidBringSuffix(`Starting ${raidName}: @viewer. Check Discord for details.`, map),
  };
}

describe("raid call preparation reminders", () => {
  it.each(restrictedMaps)("adds the %s reminder to both platform calls", (mapId, expected) => {
    const messages = messagesFor(mapId);
    expect(messages.discord).toContain(
      `. Bring: ${resolveTarkovMap(mapId)?.raidPreparationReminder}`,
    );
    expect(messages.twitch).toContain(
      ` Bring: ${resolveTarkovMap(mapId)?.raidPreparationReminder}`,
    );
    expect(messages.discord).toContain(expected);
    expect(messages.twitch).toContain(expected);
  });

  it("does not change calls for a standard map", () => {
    const map = resolveTarkovMap("customs");
    const discord = "Starting PvE · Customs: <@viewer>";
    const twitch = "Starting PvE · Customs: @viewer. Check Discord for details.";
    expect(appendRaidBringSuffix(discord, map)).toBe(discord);
    expect(appendRaidBringSuffix(twitch, map)).toBe(twitch);
  });

  it("uses one catalog reminder in every game mode", () => {
    for (const [mapId] of restrictedMaps) {
      const reminder = resolveTarkovMap(mapId)?.raidPreparationReminder;
      for (const mode of ["PvP Seasonal", "PvP", "PvE"]) {
        const messages = messagesFor(mapId, mode);
        expect(messages.discord.endsWith(`Bring: ${reminder}`)).toBe(true);
        expect(messages.twitch.endsWith(`Bring: ${reminder}`)).toBe(true);
      }
    }
  });

  it("keeps the longest maximum-party Twitch call within 500 characters", () => {
    const map = resolveTarkovMap("terminal");
    const maximumLogins = Array.from(
      { length: 3 },
      (_, index) => `@${String(index).repeat(25)}`,
    ).join(" ");
    const message = appendRaidBringSuffix(
      `Starting PvP Seasonal · Terminal: ${maximumLogins}. Check Discord for details.`,
      map,
    );
    expect(message.length).toBeLessThanOrEqual(500);
  });
});
