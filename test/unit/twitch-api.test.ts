import { describe, expect, it, vi } from "vitest";
import type { CloudflareEnvironment } from "../../src/infrastructure/cloudflare/environment";
import {
  sendTwitchChatMessage,
  validateTwitchAuthorization,
} from "../../src/infrastructure/twitch/twitch-api";

const environment = {
  TWITCH_API_BASE_URL: "https://api.twitch.tv/helix",
  TWITCH_AUTH_BASE_URL: "https://id.twitch.tv/oauth2",
  TWITCH_APP_ACCESS_TOKEN: "token-1",
} as CloudflareEnvironment;
const identity = { clientId: "client-1", botUserId: "bot-1" };

function requestBody(value: BodyInit | null | undefined): string {
  if (typeof value !== "string") throw new Error("Expected a string request body");
  return value;
}

describe("Twitch API client", () => {
  it("uses the cloud-chatbot app token and configured bot sender", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ data: [{ message_id: "message-1", is_sent: true }] }));

    const messageId = await sendTwitchChatMessage(
      environment,
      identity,
      {
        broadcasterId: "channel-1",
        message: "hello",
        replyParentMessageId: "parent-1",
      },
      fetcher,
    );

    expect(messageId).toBe("message-1");
    const request = fetcher.mock.calls[0];
    expect(request?.[0]).toBe("https://api.twitch.tv/helix/chat/messages");
    expect(request?.[1]?.headers).toEqual({
      Authorization: "Bearer token-1",
      "Client-Id": "client-1",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(requestBody(request?.[1]?.body))).toEqual({
      broadcaster_id: "channel-1",
      sender_id: "bot-1",
      message: "hello",
      reply_parent_message_id: "parent-1",
    });
  });

  it("reports a revoked or expired token without exposing it", async () => {
    const health = await validateTwitchAuthorization(
      environment,
      identity,
      vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })),
    );
    expect(health).toEqual({ ok: false, reason: "revoked_or_expired" });
  });

  it("accepts a valid app token for the configured client", async () => {
    const health = await validateTwitchAuthorization(
      environment,
      identity,
      vi.fn<typeof fetch>().mockResolvedValue(
        Response.json({
          client_id: "client-1",
          expires_in: 3600,
        }),
      ),
    );

    expect(health).toEqual({ ok: true, expiresIn: 3600 });
  });

  it.each([
    {
      label: "an unavailable validation service",
      response: new Response(null, { status: 503 }),
      expected: { ok: false, reason: "validation_unavailable" },
    },
    {
      label: "a malformed validation response",
      response: Response.json({ client_id: "client-1" }),
      expected: { ok: false, reason: "malformed_response" },
    },
    {
      label: "a token for another application",
      response: Response.json({
        client_id: "client-2",
        expires_in: 3600,
      }),
      expected: { ok: false, reason: "wrong_client" },
    },
  ])("reports $label", async ({ response, expected }) => {
    const health = await validateTwitchAuthorization(
      environment,
      identity,
      vi.fn<typeof fetch>().mockResolvedValue(response),
    );

    expect(health).toEqual(expected);
  });
});
