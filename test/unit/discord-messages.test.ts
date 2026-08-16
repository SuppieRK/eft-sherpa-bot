import { describe, expect, it } from "vitest";
import type { CloudflareEnvironment } from "../../src/infrastructure/cloudflare/environment";
import { buildDiscordHeaders } from "../../src/infrastructure/discord/messages";

const environment = {
  DISCORD_BOT_TOKEN: "bot-token",
} as CloudflareEnvironment;

const callerHeaderCases: Array<{ label: string; expected: string; value: HeadersInit }> = [
  {
    label: "an object",
    expected: "object",
    value: {
      Authorization: "Bearer caller-value",
      "Content-Type": "text/plain",
      "X-Test": "object",
    },
  },
  {
    label: "header tuples",
    expected: "tuples",
    value: [
      ["Authorization", "Bearer caller-value"],
      ["Content-Type", "text/plain"],
      ["X-Test", "tuples"],
    ],
  },
  {
    label: "a Headers object",
    expected: "headers",
    value: new Headers({
      Authorization: "Bearer caller-value",
      "Content-Type": "text/plain",
      "X-Test": "headers",
    }),
  },
];

describe("Discord API headers", () => {
  it.each(callerHeaderCases)(
    "accepts $label and enforces authentication",
    ({ expected, value }) => {
      const headers = buildDiscordHeaders(environment, value);

      expect(headers.get("Authorization")).toBe("Bot bot-token");
      expect(headers.get("Content-Type")).toBe("application/json");
      expect(headers.get("X-Test")).toBe(expected);
    },
  );
});
