import { describe, expect, it } from "vitest";
import surface from "../../config/command-surface.json";
import { PUBLIC_COMMAND_NAMES } from "../../src/domain/command-surface";

describe("command surface", () => {
  it("keeps only request and queue shared across Discord and Twitch", () => {
    expect(PUBLIC_COMMAND_NAMES).toEqual(["request", "queue"]);
    expect(surface.public.map((command) => command.name)).toEqual(["request", "queue"]);
    expect(JSON.stringify(surface)).not.toMatch(/position|spike/);
  });

  it("keeps identity linking and the board Discord-only", () => {
    expect(surface.discordViewer.map((command) => command.name)).toEqual(["link-twitch"]);
    expect(surface.discordStaff.map((command) => command.name)).toEqual(["board"]);
  });
});
