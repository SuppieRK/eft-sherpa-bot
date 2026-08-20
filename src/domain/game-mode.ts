const GAME_MODES = ["pvp-seasonal", "pvp", "pve"] as const;

export type GameMode = (typeof GAME_MODES)[number];

const GAME_MODE_LABELS: Readonly<Record<GameMode, string>> = {
  "pvp-seasonal": "PvP Seasonal",
  pvp: "PvP",
  pve: "PvE",
};

const GAME_MODE_CODES: Readonly<Record<GameMode, number>> = {
  "pvp-seasonal": 0,
  pvp: 1,
  pve: 2,
};

const TWITCH_MODE_ALIASES: ReadonlyArray<{
  alias: string;
  mode: GameMode;
}> = [
  { alias: "pvp seasonal", mode: "pvp-seasonal" },
  { alias: "pvp-seasonal", mode: "pvp-seasonal" },
  { alias: "seasonal", mode: "pvp-seasonal" },
  { alias: "pvp", mode: "pvp" },
  { alias: "pve", mode: "pve" },
];

export function parseGameMode(value: string | undefined): GameMode | undefined {
  return GAME_MODES.find((mode) => mode === value);
}

export function gameModeLabel(mode: GameMode): string {
  return GAME_MODE_LABELS[mode];
}

export function gameModeCode(mode: GameMode): number {
  return GAME_MODE_CODES[mode];
}

export function gameModeFromCode(code: number): GameMode | undefined {
  return GAME_MODES.find((mode) => GAME_MODE_CODES[mode] === code);
}

export function gameModeChoices(): ReadonlyArray<{ label: string; value: GameMode }> {
  return GAME_MODES.map((mode) => ({ label: gameModeLabel(mode), value: mode }));
}

export function formatModeMap(mode: GameMode, mapName: string): string {
  return `${gameModeLabel(mode)} · ${mapName}`;
}

export type TwitchGameModePrefix = {
  mode: GameMode;
  remainingText: string;
};

export function resolveTwitchGameModePrefix(value: string): TwitchGameModePrefix | undefined {
  const trimmed = value.trim();
  for (const { alias, mode } of TWITCH_MODE_ALIASES) {
    const pattern = new RegExp(
      String.raw`^${alias.replaceAll(" ", String.raw`\s+`)}(?:\s+|$)`,
      "i",
    );
    const match = pattern.exec(trimmed);
    if (match !== null) {
      return { mode, remainingText: trimmed.slice(match[0].length).trim() };
    }
  }
  return undefined;
}
