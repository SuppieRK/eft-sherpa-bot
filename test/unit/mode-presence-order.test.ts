import { describe, expect, it } from "vitest";
import { orderByModePresence } from "../../src/domain/mode-presence-order";

function raid(id: number, gameMode: "pvp-seasonal" | "pvp" | "pve", sortKey: number) {
  return { id, gameMode, sortKey };
}

describe("mode-presence ordering", () => {
  it("reserves each non-empty mode head before remaining FIFO work", () => {
    expect(
      orderByModePresence([
        raid(1, "pve", 1),
        raid(2, "pve", 2),
        raid(3, "pve", 3),
        raid(4, "pvp", 4),
        raid(5, "pvp-seasonal", 5),
      ]).map((item) => item.id),
    ).toEqual([1, 4, 5, 2, 3]);
  });

  it("keeps a single-mode queue in stable FIFO order", () => {
    expect(
      orderByModePresence([raid(3, "pve", 3), raid(1, "pve", 1), raid(2, "pve", 2)]).map(
        (item) => item.id,
      ),
    ).toEqual([1, 2, 3]);
  });
});
