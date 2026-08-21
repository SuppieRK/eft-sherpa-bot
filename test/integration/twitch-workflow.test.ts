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

interface TwitchEventIdentity {
  chatterUserId: string;
  chatterUserLogin: string;
  messageId: string;
}

async function eventSubRequest(
  text: string,
  deliveryId = "twitch-delivery",
  identity: TwitchEventIdentity = {
    chatterUserId: "twitch-viewer",
    chatterUserLogin: "viewer",
    messageId: "chat-message",
  },
): Promise<Request> {
  const timestamp = new Date().toISOString();
  const body = JSON.stringify({
    subscription: { type: "channel.chat.message" },
    event: {
      broadcaster_user_id: testCommunityConfig.twitch.broadcasterUserId,
      broadcaster_user_login: "butcoffee",
      chatter_user_id: identity.chatterUserId,
      chatter_user_login: identity.chatterUserLogin,
      message_id: identity.messageId,
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

  it("handles overlapping copies of one request delivery once", async () => {
    await env.DB.prepare(
      `INSERT INTO community_state
         (community_id, staff_board_message_id, created_at, updated_at)
       VALUES ('butcoffee', 'canonical-board', ?, ?)`,
    )
      .bind(Date.now(), Date.now())
      .run();
    const outbound: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      outbound.push(url);
      return Promise.resolve(
        url.includes("discord.test")
          ? Response.json({ id: "canonical-board" })
          : Response.json({ data: [{ message_id: "sent-message", is_sent: true }] }),
      );
    });
    const request = await eventSubRequest(
      "!request pve customs pocket watch",
      "overlapping-request",
    );
    const contexts = Array.from({ length: 10 }, () => createExecutionContext());

    const responses = await Promise.all(
      contexts.map((context) => worker.fetch(request.clone(), testEnvironment, context)),
    );
    await Promise.all(contexts.map((context) => waitOnExecutionContext(context)));

    expect(responses.map(({ status }) => status)).toEqual(Array.from({ length: 10 }, () => 204));
    expect(outbound.filter((url) => url.includes("api.twitch.tv"))).toHaveLength(1);
    expect(outbound.filter((url) => url.includes("discord.test"))).toHaveLength(1);
    await expect(
      env.DB.prepare(`SELECT count(*) AS count FROM help_requests`).first(),
    ).resolves.toEqual({ count: 1 });
    await expect(
      env.DB.prepare(`SELECT count(*) AS count FROM raid_group_members`).first(),
    ).resolves.toEqual({ count: 1 });
    await expect(
      env.DB.prepare(`SELECT reply_attempts AS attempts FROM event_receipts`).first(),
    ).resolves.toEqual({ attempts: 1 });
  });

  it.each([
    { mapId: "customs", requesterCount: 12, requesterCapacity: 4 },
    { mapId: "icebreaker", requesterCount: 6, requesterCapacity: 2 },
  ])(
    "groups $requesterCount concurrent $mapId requesters without empty or over-capacity raids",
    async ({ mapId, requesterCount, requesterCapacity }) => {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(
        Response.json({ data: [{ message_id: "sent-message", is_sent: true }] }),
      );
      const contexts = Array.from({ length: requesterCount }, () => createExecutionContext());
      const requests = await Promise.all(
        contexts.map((_, index) =>
          eventSubRequest(`!request pve ${mapId} task`, `concurrent-${index}`, {
            chatterUserId: `twitch-viewer-${index}`,
            chatterUserLogin: `viewer${index}`,
            messageId: `chat-message-${index}`,
          }),
        ),
      );

      await Promise.all(
        requests.map((request, index) =>
          worker.fetch(request, testEnvironment, contexts[index] as ExecutionContext),
        ),
      );
      await Promise.all(contexts.map((context) => waitOnExecutionContext(context)));

      await expect(
        env.DB.prepare(`SELECT count(*) AS count FROM help_requests`).first(),
      ).resolves.toEqual({ count: requesterCount });
      await expect(
        env.DB.prepare(`SELECT count(*) AS count FROM raid_group_members WHERE state = 0`).first(),
      ).resolves.toEqual({ count: requesterCount });
      const raids = await env.DB.prepare(
        `SELECT current_member_count AS memberCount, requester_capacity AS capacity
         FROM raid_groups ORDER BY sort_key`,
      ).all<{ memberCount: number; capacity: number }>();
      expect(raids.results).toEqual(
        Array.from({ length: requesterCount / requesterCapacity }, () => ({
          memberCount: requesterCapacity,
          capacity: requesterCapacity,
        })),
      );
    },
  );

  it("keeps one active request for concurrent commands from one identity", async () => {
    const twitchFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ data: [{ message_id: "sent-message", is_sent: true }] }));
    const contexts = Array.from({ length: 6 }, () => createExecutionContext());
    const requests = await Promise.all(
      contexts.map((_, index) =>
        eventSubRequest("!request pve customs task", `same-viewer-${index}`),
      ),
    );

    await Promise.all(
      requests.map((request, index) =>
        worker.fetch(request, testEnvironment, contexts[index] as ExecutionContext),
      ),
    );
    await Promise.all(contexts.map((context) => waitOnExecutionContext(context)));

    await expect(
      env.DB.prepare(`SELECT count(*) AS count FROM help_requests`).first(),
    ).resolves.toEqual({ count: 1 });
    await expect(
      env.DB.prepare(`SELECT count(*) AS count FROM raid_group_members WHERE state = 0`).first(),
    ).resolves.toEqual({ count: 1 });
    expect(twitchFetch).toHaveBeenCalledTimes(6);
  });

  it("claims one retry after an overlapping Twitch reply failure", async () => {
    const twitchFetch = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValueOnce(new Error("Twitch unavailable"));
    const request = await eventSubRequest("!queue", "failed-retry");
    const firstContext = createExecutionContext();
    await worker.fetch(request.clone(), testEnvironment, firstContext);
    await waitOnExecutionContext(firstContext);
    twitchFetch.mockResolvedValue(
      Response.json({ data: [{ message_id: "retry-message", is_sent: true }] }),
    );
    const retryContexts = Array.from({ length: 5 }, () => createExecutionContext());

    await Promise.all(
      retryContexts.map((context) => worker.fetch(request.clone(), testEnvironment, context)),
    );
    await Promise.all(retryContexts.map((context) => waitOnExecutionContext(context)));

    expect(twitchFetch).toHaveBeenCalledTimes(2);
    await expect(
      env.DB.prepare(
        `SELECT reply_status AS replyStatus, reply_attempts AS attempts
         FROM event_receipts WHERE platform = 1 AND delivery_id = 'failed-retry'`,
      ).first(),
    ).resolves.toEqual({ replyStatus: 1, attempts: 2 });
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
