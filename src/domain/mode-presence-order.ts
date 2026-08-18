import type { GameMode } from "./game-mode";

export interface ModeOrderedItem {
  gameMode: GameMode;
  sortKey: number;
}

export function orderByModePresence<T extends ModeOrderedItem>(items: readonly T[]): T[] {
  const stable = [...items].sort((left, right) => left.sortKey - right.sortKey);
  const seen = new Set<GameMode>();
  const heads: T[] = [];
  const remaining: T[] = [];
  for (const item of stable) {
    if (seen.has(item.gameMode)) {
      remaining.push(item);
    } else {
      seen.add(item.gameMode);
      heads.push(item);
    }
  }
  return [...heads, ...remaining];
}
