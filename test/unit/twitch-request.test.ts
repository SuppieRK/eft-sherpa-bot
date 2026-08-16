import { describe, expect, it } from "vitest";
import {
  parseTwitchRequestInput,
  TWITCH_REQUEST_DEFAULT_GOAL,
} from "../../src/domain/twitch-request";

describe("Twitch-native request input", () => {
  it("defaults the goal and preserves supplied goal text", () => {
    expect(parseTwitchRequestInput("customs")).toMatchObject({
      valid: true,
      map: { id: "customs" },
      goal: TWITCH_REQUEST_DEFAULT_GOAL,
    });
    expect(parseTwitchRequestInput("Ground-Zero Saving the Mole")).toMatchObject({
      valid: true,
      map: { id: "ground-zero" },
      goal: "Saving the Mole",
    });
  });

  it("does not accept or create an unknown map", () => {
    expect(parseTwitchRequestInput("custms pocket watch")).toMatchObject({
      valid: false,
      reason: "unknown_map",
      suggestion: { id: "customs" },
    });
    expect(parseTwitchRequestInput("somewhere task")).toEqual({
      valid: false,
      reason: "unknown_map",
    });
  });

  it("rejects a goal longer than 150 characters", () => {
    expect(parseTwitchRequestInput(`customs ${"x".repeat(151)}`)).toEqual({
      valid: false,
      reason: "goal_too_long",
    });
  });
});
