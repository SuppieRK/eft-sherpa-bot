import { describe, expect, it } from "vitest";
import {
  parseTwitchRequestInput,
  TWITCH_REQUEST_DEFAULT_GOAL,
} from "../../src/domain/twitch-request";

describe("Twitch-native request input", () => {
  it("defaults the goal and preserves supplied goal text", () => {
    expect(parseTwitchRequestInput("pve customs")).toMatchObject({
      valid: true,
      gameMode: "pve",
      map: { id: "customs" },
      goal: TWITCH_REQUEST_DEFAULT_GOAL,
    });
    expect(parseTwitchRequestInput("pvp Ground-Zero Saving the Mole")).toMatchObject({
      valid: true,
      gameMode: "pvp",
      map: { id: "ground-zero" },
      goal: "Saving the Mole",
    });
  });

  it.each(["pvp-seasonal", "pvp seasonal", "seasonal"])(
    "accepts the PvP Seasonal alias %s",
    (alias) => {
      expect(parseTwitchRequestInput(`${alias} customs task help`)).toMatchObject({
        valid: true,
        gameMode: "pvp-seasonal",
        map: { id: "customs" },
        goal: "task help",
      });
    },
  );

  it("requires a supported mode before the map", () => {
    expect(parseTwitchRequestInput("")).toEqual({ valid: false, reason: "missing_mode" });
    expect(parseTwitchRequestInput("customs task")).toEqual({
      valid: false,
      reason: "unknown_mode",
    });
  });

  it("does not accept or create an unknown map", () => {
    expect(parseTwitchRequestInput("pve custms pocket watch")).toMatchObject({
      valid: false,
      reason: "unknown_map",
      gameMode: "pve",
      suggestion: { id: "customs" },
    });
    expect(parseTwitchRequestInput("pve somewhere task")).toEqual({
      valid: false,
      reason: "unknown_map",
      gameMode: "pve",
    });
  });

  it("rejects a goal longer than 150 characters", () => {
    expect(parseTwitchRequestInput(`pve customs ${"x".repeat(151)}`)).toEqual({
      valid: false,
      reason: "goal_too_long",
      gameMode: "pve",
    });
  });
});
