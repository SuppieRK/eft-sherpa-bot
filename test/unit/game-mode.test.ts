import { describe, expect, it } from "vitest";
import {
  formatModeMap,
  gameModeChoices,
  gameModeCode,
  gameModeFromCode,
  resolveTwitchGameModePrefix,
} from "../../src/domain/game-mode";
import {
  buildDiscordRequestModal,
  DISCORD_REQUEST_MODAL_ID,
  requestModalGameMode,
} from "../../src/infrastructure/discord/request-form";

describe("game modes", () => {
  it("maps canonical values to compact stable database codes", () => {
    expect(gameModeCode("pvp-seasonal")).toBe(0);
    expect(gameModeCode("pvp")).toBe(1);
    expect(gameModeCode("pve")).toBe(2);
    expect([0, 1, 2].map(gameModeFromCode)).toEqual(["pvp-seasonal", "pvp", "pve"]);
    expect(gameModeFromCode(3)).toBeUndefined();
  });

  it("provides Discord choices and public labels", () => {
    expect(gameModeChoices()).toEqual([
      { label: "PvP Seasonal", value: "pvp-seasonal" },
      { label: "PvP", value: "pvp" },
      { label: "PvE", value: "pve" },
    ]);
    expect(formatModeMap("pvp-seasonal", "Customs")).toBe("PvP Seasonal · Customs");
  });

  it("matches the longest Twitch mode alias first", () => {
    expect(resolveTwitchGameModePrefix("pvp seasonal customs")).toEqual({
      mode: "pvp-seasonal",
      remainingText: "customs",
    });
    expect(resolveTwitchGameModePrefix("seasonal customs")).toEqual({
      mode: "pvp-seasonal",
      remainingText: "customs",
    });
  });

  it("carries Discord mode in versioned modal state and treats v1 as PvE", () => {
    const modal = buildDiscordRequestModal("pvp");
    expect(modal.custom_id).toBe("request:create:v2:pvp");
    expect(requestModalGameMode(modal.custom_id)).toBe("pvp");
    expect(requestModalGameMode(DISCORD_REQUEST_MODAL_ID)).toBe("pve");
    expect(requestModalGameMode("request:create:v2:unknown")).toBeUndefined();
  });
});
