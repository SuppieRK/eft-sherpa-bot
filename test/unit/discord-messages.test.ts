import { describe, expect, it, vi } from "vitest";
import { BOARD_DRAIN_LEASE_MS } from "../../src/infrastructure/cloudflare/d1-mvp-repository";
import type { CloudflareEnvironment } from "../../src/infrastructure/cloudflare/environment";
import {
  createDiscordMessage,
  DISCORD_REQUEST_TIMEOUT_MS,
} from "../../src/infrastructure/discord/messages";

describe("Discord REST requests", () => {
  it("use an abort deadline shorter than the board lease", async () => {
    let requestSignal: AbortSignal | null | undefined;
    const fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) => {
      requestSignal = init?.signal;
      return Promise.resolve(Response.json({ id: "message" }));
    });
    const environment = {
      DISCORD_BOT_TOKEN: "test-token",
      DISCORD_API_BASE_URL: "https://discord.test/api/v10",
      DISCORD_API_FETCHER: { fetch },
    } as unknown as CloudflareEnvironment;

    await expect(
      createDiscordMessage(environment, "channel", { content: "board" }),
    ).resolves.toEqual({ id: "message" });

    expect(requestSignal).toBeInstanceOf(AbortSignal);
    expect(requestSignal?.aborted).toBe(false);
    expect(DISCORD_REQUEST_TIMEOUT_MS).toBeLessThan(BOARD_DRAIN_LEASE_MS);
  });
});
