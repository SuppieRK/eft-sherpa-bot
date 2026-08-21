import { describe, expect, it } from "vitest";
import {
  canTransitionRequest,
  supportedMapChoices,
  validateRequestForm,
} from "../../src/domain/help-request";
import type { RequestState } from "../../src/domain/sherpa-repository";

describe("help request form", () => {
  it("accepts the minimum form and resolves a map alias", () => {
    expect(
      validateRequestForm({
        gameMode: "pve",
        twitchLogin: "  @Viewer_Name  ",
        inGameName: "  Helpful PMC  ",
        map: "SOT",
        objective: "  Complete Audit  ",
      }),
    ).toEqual({
      valid: true,
      value: {
        gameMode: "pve",
        inGameName: "Helpful PMC",
        twitchLogin: "viewer_name",
        mapId: "streets-of-tarkov",
        objective: "Complete Audit",
      },
    });
  });

  it("keeps optional notes trimmed", () => {
    expect(
      validateRequestForm({
        gameMode: "pve",
        twitchLogin: "ViewerName",
        inGameName: "Helpful PMC",
        map: "customs",
        objective: "Find the convoy",
        notes: "  Bring markers  ",
      }),
    ).toEqual({
      valid: true,
      value: {
        gameMode: "pve",
        inGameName: "Helpful PMC",
        twitchLogin: "viewername",
        mapId: "customs",
        objective: "Find the convoy",
        notes: "Bring markers",
      },
    });
    expect(
      validateRequestForm({
        gameMode: "pve",
        twitchLogin: "ViewerName",
        inGameName: "Helpful PMC",
        map: "customs",
        objective: "Find the convoy",
        notes: "  ",
      }),
    ).toEqual({
      valid: true,
      value: {
        gameMode: "pve",
        inGameName: "Helpful PMC",
        twitchLogin: "viewername",
        mapId: "customs",
        objective: "Find the convoy",
      },
    });
  });

  it("returns field-specific guidance for missing data and unsupported maps", () => {
    expect(
      validateRequestForm({
        gameMode: "pve",
        twitchLogin: "bad name!",
        inGameName: " ",
        map: "not-a-map",
        objective: "",
      }),
    ).toEqual({
      valid: false,
      issues: [
        {
          field: "twitchLogin",
          message: "Enter your Twitch name using letters, numbers, or underscore.",
        },
        { field: "inGameName", message: "Enter your in-game name." },
        { field: "map", message: "Choose one of the supported maps." },
        { field: "objective", message: "Enter the objective or task." },
      ],
    });
    expect(supportedMapChoices().some((choice) => choice.value === "icebreaker")).toBe(true);
  });

  it("rejects goals over 150 and notes over 250 characters", () => {
    const validation = validateRequestForm({
      gameMode: "pve",
      twitchLogin: "viewer",
      inGameName: "PMC",
      map: "customs",
      objective: "x".repeat(151),
      notes: "n".repeat(251),
    });
    expect(validation).toMatchObject({
      valid: false,
      issues: [
        { field: "objective", message: expect.stringContaining("150") },
        { field: "notes", message: expect.stringContaining("250") },
      ],
    });
  });
});

describe("help request lifecycle", () => {
  const states: RequestState[] = ["waiting", "planned", "completed", "canceled"];
  const allowed = new Set([
    "waiting:planned",
    "waiting:canceled",
    "planned:completed",
    "planned:canceled",
  ]);

  it("defines every valid and invalid state pair", () => {
    for (const from of states) {
      for (const to of states) {
        expect(canTransitionRequest(from, to), `${from} -> ${to}`).toBe(
          allowed.has(`${from}:${to}`),
        );
      }
    }
  });
});
