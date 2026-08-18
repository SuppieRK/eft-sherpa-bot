import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorker } from "../../src";
import type { CloudflareEnvironment } from "../../src/infrastructure/cloudflare/environment";
import { createTwitchEventSubSignature } from "../../src/infrastructure/twitch/eventsub";
import { testCommunityConfig } from "../fixtures/community";

const testEnvironment = env as CloudflareEnvironment;
const worker = createWorker(testCommunityConfig);

function requestBody(value: BodyInit | null | undefined): string {
  if (typeof value !== "string") throw new Error("Expected a string request body");
  return value;
}

async function eventSubRequest(text: string, deliveryId = "twitch-delivery"): Promise<Request> {
  const timestamp = new Date().toISOString();
  const body = JSON.stringify({
    subscription: { type: "channel.chat.message" },
    event: {
      broadcaster_user_id: testCommunityConfig.twitch.broadcasterUserId,
      broadcaster_user_login: "butcoffee",
      chatter_user_id: "twitch-viewer",
      chatter_user_login: "viewer",
      message_id: "chat-message",
      message: { text },
    },
  });
  const signature = await createTwitchEventSubSignature(
    "test-eventsub-secret-is-long-enough",
    deliveryId,
    timestamp,
    body,
  );
  return new Request("https://example.com/webhooks/twitch/eventsub", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Twitch-Eventsub-Message-Id": deliveryId,
      "Twitch-Eventsub-Message-Timestamp": timestamp,
      "Twitch-Eventsub-Message-Signature": signature,
      "Twitch-Eventsub-Message-Type": "notification",
      "Twitch-Eventsub-Subscription-Type": "channel.chat.message",
    },
    body,
  });
}

afterEach(() => vi.restoreAllMocks());

describe("Twitch private-pilot commands", () => {
  it.each([
    ["!request", "use !request [mode] [map] [goal]"],
    [`!request pve customs ${"x".repeat(151)}`, "150 characters"],
  ])("answers %s with the expected public guidance", async (command, expectedText) => {
    const twitchFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(Response.json({ data: [{ message_id: "sent-message", is_sent: true }] })),
      );
    const context = createExecutionContext();
    expect(
      (
        await worker.fetch(
          await eventSubRequest(command, `delivery-${command}`),
          testEnvironment,
          context,
        )
      ).status,
    ).toBe(204);
    await waitOnExecutionContext(context);
    const request = twitchFetch.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(requestBody(request?.body).toLowerCase()).toContain(expectedText);
  });

  it("creates a Twitch-native request and keeps one active request per mode and map", async () => {
    const twitchFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(Response.json({ data: [{ message_id: "sent-message", is_sent: true }] })),
      );
    for (const [deliveryId, text] of [
      ["request-one", "!request pve customs pocket watch"],
      ["request-two", "!request pve customs a different goal"],
    ] as const) {
      const context = createExecutionContext();
      await worker.fetch(await eventSubRequest(text, deliveryId), testEnvironment, context);
      await waitOnExecutionContext(context);
    }
    expect(twitchFetch).toHaveBeenCalledTimes(2);
    expect(requestBody(twitchFetch.mock.calls[0]?.[1]?.body)).toContain("queued for PvE · Customs");
    expect(requestBody(twitchFetch.mock.calls[1]?.[1]?.body)).toContain(
      "already queued for PvE · Customs",
    );
    expect(
      await env.DB.prepare(
        `SELECT twitch_login AS twitchLogin, in_game_name AS inGameName
         FROM user_mappings`,
      ).first(),
    ).toEqual({ twitchLogin: "viewer", inGameName: "viewer" });
    expect(
      await env.DB.prepare(`SELECT count(*) AS count, objective FROM help_requests`).first(),
    ).toEqual({ count: 1, objective: "pocket watch" });
  });

  it("uses authenticated Twitch identity in the combined queue response", async () => {
    const twitchFetch = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(() =>
        Promise.resolve(Response.json({ data: [{ message_id: "sent-message", is_sent: true }] })),
      );
    for (const [deliveryId, text] of [
      ["queue-request", "!request pve woods"],
      ["queue-check", "!queue"],
    ] as const) {
      const context = createExecutionContext();
      await worker.fetch(await eventSubRequest(text, deliveryId), testEnvironment, context);
      await waitOnExecutionContext(context);
    }
    const reply = requestBody(twitchFetch.mock.calls[1]?.[1]?.body);
    expect(reply).toContain("Woods");
    expect(reply).toContain("1st in the PvE queue");
    expect(reply).toContain("no raids ahead");
    expect(reply).not.toContain("C1");
  });

  it("ignores the removed position command", async () => {
    const twitchFetch = vi.spyOn(globalThis, "fetch");
    const context = createExecutionContext();
    expect(
      (
        await worker.fetch(
          await eventSubRequest("!position", "removed-position"),
          testEnvironment,
          context,
        )
      ).status,
    ).toBe(204);
    await waitOnExecutionContext(context);
    expect(twitchFetch).not.toHaveBeenCalled();
  });

  it("answers !queue once when EventSub repeats a delivery", async () => {
    const twitchFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ data: [{ message_id: "sent-message", is_sent: true }] }));
    const request = await eventSubRequest("!queue");
    const firstContext = createExecutionContext();
    expect((await worker.fetch(request.clone(), testEnvironment, firstContext)).status).toBe(204);
    await waitOnExecutionContext(firstContext);
    const duplicateContext = createExecutionContext();
    expect((await worker.fetch(request.clone(), testEnvironment, duplicateContext)).status).toBe(
      204,
    );
    await waitOnExecutionContext(duplicateContext);

    expect(twitchFetch).toHaveBeenCalledTimes(1);
    expect(
      await env.DB.prepare(
        `SELECT CASE reply_status WHEN 1 THEN 'sent' ELSE 'other' END AS replyStatus,
                reply_attempts AS attempts
         FROM event_receipts WHERE platform = 1`,
      ).first(),
    ).toEqual({ replyStatus: "sent", attempts: 1 });
    expect(
      await env.DB.prepare(
        `SELECT twitch_login AS twitchLogin, twitch_user_id AS twitchUserId
         FROM user_mappings`,
      ).first(),
    ).toEqual({ twitchLogin: "viewer", twitchUserId: "twitch-viewer" });
  });

  it("keeps public commands available in the MVP environment", async () => {
    const twitchFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ data: [{ message_id: "sent-message", is_sent: true }] }));
    const context = createExecutionContext();
    expect(
      (
        await worker.fetch(
          await eventSubRequest("!queue", "mvp-command"),
          { ...testEnvironment, APP_ENV: "mvp" },
          context,
        )
      ).status,
    ).toBe(204);
    await waitOnExecutionContext(context);
    expect(twitchFetch).toHaveBeenCalledTimes(1);
    expect(requestBody(twitchFetch.mock.calls[0]?.[1]?.body)).toContain(
      "Use !request [mode] [map] [goal]",
    );
  });
});
