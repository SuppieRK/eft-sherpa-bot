import { describe, expect, it } from "vitest";
import sourceSnapshotText from "../../docs/data/tarkov-maps-2026-08-14.json?raw";
import {
  resolveTarkovMap,
  resolveTarkovMapPrefix,
  suggestTarkovMap,
  TARKOV_MAP_CATALOG_SOURCE,
  TARKOV_MAP_CATALOG_VERSION,
  TARKOV_MAPS,
} from "../../src/domain/maps/catalog";

const expectedMapIds = [
  "customs",
  "factory",
  "ground-zero",
  "icebreaker",
  "interchange",
  "lighthouse",
  "reserve",
  "shoreline",
  "streets-of-tarkov",
  "terminal",
  "the-lab",
  "the-labyrinth",
  "woods",
];

const expectedSourceVariants = [
  "customs",
  "factory",
  "ground-zero",
  "ground-zero-21",
  "ground-zero-tutorial",
  "icebreaker",
  "interchange",
  "lighthouse",
  "night-factory",
  "reserve",
  "shoreline",
  "streets-of-tarkov",
  "terminal",
  "the-lab",
  "the-lab-dark",
  "the-labyrinth",
  "woods",
];

const expectedPreparationReminders = {
  "the-lab": "Each player: TerraGroup Labs access keycard.",
  "the-labyrinth": "Each player: Labrys access keycard. Party: one Knossos LLC facility key.",
  terminal:
    "Each player: Reprogrammed RFID keycard with Mr. Kerman's hash codes + Secure container Alpha-1 with TerraGroup evidence, RFID keycard with unknown name, Reprogrammed RFID keycard with Prapor's hash codes, or Prapor's letter for the port checkpoint. Enter through Shoreline from 21:00 to 06:00.",
  icebreaker: "Each player: current Rouble entry fee and current Euro exit fee.",
} as const;

describe("Tarkov map catalog", () => {
  it("contains every supported canonical map", () => {
    expect(TARKOV_MAPS.map((map) => map.id).sort()).toEqual(expectedMapIds);
  });

  it("accounts for every location variant in the recorded snapshot", () => {
    const sourceVariants = TARKOV_MAPS.flatMap((map) => map.sourceNormalizedNames).sort();
    expect(sourceVariants).toEqual(expectedSourceVariants);
  });

  it("has unique normalized aliases", () => {
    const aliases = TARKOV_MAPS.flatMap((map) =>
      map.aliases.map((alias) => alias.trim().toLocaleLowerCase("en-US").replaceAll(/[-_]+/g, " ")),
    );
    expect(new Set(aliases).size).toBe(aliases.length);
  });

  it("uses five-person parties except for three-person Icebreaker parties", () => {
    for (const map of TARKOV_MAPS) {
      expect(Number.isInteger(map.sherpaPartyCapacity)).toBe(true);
      expect(map.sherpaPartyCapacity).toBe(map.id === "icebreaker" ? 3 : 5);
    }
  });

  it("defines exact preparation reminders only for restricted maps", () => {
    expect(
      Object.fromEntries(
        TARKOV_MAPS.flatMap((map) =>
          "raidPreparationReminder" in map ? [[map.id, map.raidPreparationReminder] as const] : [],
        ),
      ),
    ).toEqual(expectedPreparationReminders);
    for (const map of TARKOV_MAPS) {
      if (map.id in expectedPreparationReminders) continue;
      expect("raidPreparationReminder" in map).toBe(false);
    }
  });

  it("uses the same preparation reminder in every supported game mode", () => {
    const gameModes = ["pvp-seasonal", "pvp", "pve"] as const;
    for (const mapId of Object.keys(expectedPreparationReminders)) {
      const reminder = resolveTarkovMap(mapId)?.raidPreparationReminder;
      const remindersByMode = Object.fromEntries(
        gameModes.map((gameMode) => [gameMode, resolveTarkovMap(mapId)?.raidPreparationReminder]),
      );
      expect(remindersByMode).toEqual(
        Object.fromEntries(gameModes.map((mode) => [mode, reminder])),
      );
    }
  });

  it("names both Icebreaker fee currencies without freezing their amounts", () => {
    const reminder = resolveTarkovMap("icebreaker")?.raidPreparationReminder;
    expect(reminder).toContain("Rouble entry fee");
    expect(reminder).toContain("Euro exit fee");
    expect(reminder).not.toMatch(/\d/);
  });

  it("resolves aliases without leaking catalog representation", () => {
    expect(resolveTarkovMap("  SOT ")?.id).toBe("streets-of-tarkov");
    expect(resolveTarkovMap("night-factory")?.id).toBe("factory");
    expect(resolveTarkovMap("unknown map")).toBeUndefined();
  });

  it("resolves the longest request prefix and offers only a unique close suggestion", () => {
    expect(resolveTarkovMapPrefix("ground zero Saving the Mole")).toMatchObject({
      map: { id: "ground-zero" },
      remainingText: "Saving the Mole",
    });
    expect(resolveTarkovMapPrefix("customs pocket watch")).toMatchObject({
      map: { id: "customs" },
      remainingText: "pocket watch",
    });
    expect(suggestTarkovMap("custms")?.id).toBe("customs");
    expect(suggestTarkovMap("no such place")).toBeUndefined();
  });

  it("has reproducible source and catalog versions", () => {
    const sourceSnapshot = JSON.parse(sourceSnapshotText) as {
      rawResponseSha256: string;
      maps: Array<{ normalizedName: string }>;
    };

    expect(TARKOV_MAP_CATALOG_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}\.\d+$/);
    expect(TARKOV_MAP_CATALOG_SOURCE.retrievedOn).toBe("2026-08-14");
    expect(TARKOV_MAP_CATALOG_SOURCE.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(sourceSnapshot.rawResponseSha256).toBe(TARKOV_MAP_CATALOG_SOURCE.sha256);
    expect(sourceSnapshot.maps.map((map) => map.normalizedName).sort()).toEqual(
      expectedSourceVariants,
    );
  });
});
