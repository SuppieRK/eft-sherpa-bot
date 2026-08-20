export interface TarkovMapCatalogSource {
  endpoint: string;
  retrievedOn: string;
  sha256: string;
  gameMode: "pve";
  snapshotPath: string;
}

export interface TarkovMapDefinition {
  id: string;
  name: string;
  aliases: readonly string[];
  sherpaPartyCapacity: number;
  readonly raidPreparationReminder?: string;
  sourceLocationIds: readonly string[];
  sourceNormalizedNames: readonly string[];
}

export const TARKOV_MAP_CATALOG_VERSION = "2026-08-20.1";

export const TARKOV_MAP_CATALOG_SOURCE: TarkovMapCatalogSource = {
  endpoint: "https://json.tarkov.dev/pve/maps?lang=en",
  retrievedOn: "2026-08-14",
  sha256: "b778d4233760c546d7359304ab27cd02f2646bdead0a29863e26d66d4046d061",
  gameMode: "pve",
  snapshotPath: "docs/data/tarkov-maps-2026-08-14.json",
};

export const TARKOV_MAPS = [
  {
    id: "factory",
    name: "Factory",
    aliases: ["factory", "fac", "night factory", "factory night"],
    sherpaPartyCapacity: 5,
    sourceLocationIds: ["55f2d3fd4bdc2d5f408b4567", "59fc81d786f774390775787e"],
    sourceNormalizedNames: ["factory", "night-factory"],
  },
  {
    id: "customs",
    name: "Customs",
    aliases: ["customs", "custom", "big red"],
    sherpaPartyCapacity: 5,
    sourceLocationIds: ["56f40101d2720b2a4d8b45d6"],
    sourceNormalizedNames: ["customs"],
  },
  {
    id: "woods",
    name: "Woods",
    aliases: ["woods", "wood"],
    sherpaPartyCapacity: 5,
    sourceLocationIds: ["5704e3c2d2720bac5b8b4567"],
    sourceNormalizedNames: ["woods"],
  },
  {
    id: "lighthouse",
    name: "Lighthouse",
    aliases: ["lighthouse", "light house", "lh"],
    sherpaPartyCapacity: 5,
    sourceLocationIds: ["5704e4dad2720bb55b8b4567"],
    sourceNormalizedNames: ["lighthouse"],
  },
  {
    id: "shoreline",
    name: "Shoreline",
    aliases: ["shoreline", "shore", "resort"],
    sherpaPartyCapacity: 5,
    sourceLocationIds: ["5704e554d2720bac5b8b456e"],
    sourceNormalizedNames: ["shoreline"],
  },
  {
    id: "reserve",
    name: "Reserve",
    aliases: ["reserve", "rezerv", "military base"],
    sherpaPartyCapacity: 5,
    sourceLocationIds: ["5704e5fad2720bc05b8b4567"],
    sourceNormalizedNames: ["reserve"],
  },
  {
    id: "interchange",
    name: "Interchange",
    aliases: ["interchange", "inter", "mall"],
    sherpaPartyCapacity: 5,
    sourceLocationIds: ["5714dbc024597771384a510d"],
    sourceNormalizedNames: ["interchange"],
  },
  {
    id: "streets-of-tarkov",
    name: "Streets of Tarkov",
    aliases: ["streets of tarkov", "streets", "sot"],
    sherpaPartyCapacity: 5,
    sourceLocationIds: ["5714dc692459777137212e12"],
    sourceNormalizedNames: ["streets-of-tarkov"],
  },
  {
    id: "the-lab",
    name: "The Lab",
    aliases: ["the lab", "lab", "labs", "dark lab", "lab dark"],
    sherpaPartyCapacity: 5,
    raidPreparationReminder: "Each player: TerraGroup Labs access keycard.",
    sourceLocationIds: ["5b0fc42d86f7744a585f9105", "6a294a5b5eb5f9a1700417b7"],
    sourceNormalizedNames: ["the-lab", "the-lab-dark"],
  },
  {
    id: "ground-zero",
    name: "Ground Zero",
    aliases: ["ground zero", "groundzero", "gz", "ground zero 21+"],
    sherpaPartyCapacity: 5,
    sourceLocationIds: [
      "653e6760052c01c1c805532f",
      "65b8d6f5cdde2479cb2a3125",
      "68236e8153654e8c1200798a",
    ],
    sourceNormalizedNames: ["ground-zero", "ground-zero-21", "ground-zero-tutorial"],
  },
  {
    id: "terminal",
    name: "Terminal",
    aliases: ["terminal", "term"],
    sherpaPartyCapacity: 5,
    raidPreparationReminder:
      "Each player: Reprogrammed RFID keycard with Mr. Kerman's hash codes + Secure container Alpha-1 with TerraGroup evidence, RFID keycard with unknown name, Reprogrammed RFID keycard with Prapor's hash codes, or Prapor's letter for the port checkpoint. Enter through Shoreline from 21:00 to 06:00.",
    sourceLocationIds: ["65cc8f81a9aac3e77d0cfd3e"],
    sourceNormalizedNames: ["terminal"],
  },
  {
    id: "the-labyrinth",
    name: "The Labyrinth",
    aliases: ["the labyrinth", "labyrinth", "maze"],
    sherpaPartyCapacity: 5,
    raidPreparationReminder:
      "Each player: Labrys access keycard. Party: one Knossos LLC facility key.",
    sourceLocationIds: ["6733700029c367a3d40b02af"],
    sourceNormalizedNames: ["the-labyrinth"],
  },
  {
    id: "icebreaker",
    name: "Icebreaker",
    aliases: ["icebreaker", "ice breaker", "boreas"],
    sherpaPartyCapacity: 3,
    raidPreparationReminder: "Each player: current Rouble entry fee and current Euro exit fee.",
    sourceLocationIds: ["69af492a4819ea4ba10a69c5"],
    sourceNormalizedNames: ["icebreaker"],
  },
] as const satisfies readonly TarkovMapDefinition[];

function normalizeMapInput(value: string): string {
  return value.trim().toLocaleLowerCase("en-US").replaceAll(/[-_]+/g, " ").replaceAll(/\s+/g, " ");
}

const mapByAlias = new Map(
  TARKOV_MAPS.flatMap((map) =>
    map.aliases.map((alias) => [normalizeMapInput(alias), map] as const),
  ),
);

export function resolveTarkovMap(value: string): TarkovMapDefinition | undefined {
  return mapByAlias.get(normalizeMapInput(value));
}

const aliasPrefixes = TARKOV_MAPS.flatMap((map) =>
  map.aliases.map((alias) => ({ map, alias: normalizeMapInput(alias) })),
).sort((left, right) => right.alias.length - left.alias.length);

export function resolveTarkovMapPrefix(
  value: string,
): { map: TarkovMapDefinition; remainingText: string } | undefined {
  const trimmed = value.trim();
  for (const candidate of aliasPrefixes) {
    const pattern = candidate.alias
      .split(" ")
      .map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`))
      .join(String.raw`[\s_-]+`);
    const match = new RegExp(String.raw`^${pattern}(?=\s|$)`, "i").exec(trimmed);
    if (match !== null) {
      return {
        map: candidate.map,
        remainingText: trimmed.slice(match[0].length).trim(),
      };
    }
  }
  return undefined;
}

function levenshtein(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        (current[rightIndex - 1] ?? 0) + 1,
        (previous[rightIndex] ?? 0) + 1,
        (previous[rightIndex - 1] ?? 0) + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? left.length;
}

export function suggestTarkovMap(value: string): TarkovMapDefinition | undefined {
  const normalized = normalizeMapInput(value);
  if (normalized.length === 0) {
    return undefined;
  }
  const matches = aliasPrefixes
    .map((candidate) => {
      const inputPrefix = normalized
        .split(" ")
        .slice(0, candidate.alias.split(" ").length)
        .join(" ");
      return { ...candidate, distance: levenshtein(inputPrefix, candidate.alias) };
    })
    .filter(
      (candidate) => candidate.distance <= Math.max(1, Math.floor(candidate.alias.length * 0.2)),
    )
    .sort((left, right) => left.distance - right.distance);
  const best = matches[0];
  if (best === undefined) {
    return undefined;
  }
  const equallyCloseMapIds = new Set(
    matches.filter((match) => match.distance === best.distance).map((match) => match.map.id),
  );
  return equallyCloseMapIds.size === 1 ? best.map : undefined;
}
