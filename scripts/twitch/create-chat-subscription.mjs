import { pathToFileURL } from "node:url";
import { requireCommunityConfig } from "../community-config.mjs";

function requireValue(environment, name) {
  const value = environment[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value.trim();
}

function callbackUrl(environment) {
  const explicit = environment.TWITCH_CALLBACK_URL?.trim();
  const base = environment.WORKER_BASE_URL?.trim();
  const callback = new URL(
    explicit ??
      `${requireValue({ WORKER_BASE_URL: base }, "WORKER_BASE_URL").replace(/\/$/, "")}/webhooks/twitch/eventsub`,
  );
  if (callback.protocol !== "https:" || callback.pathname !== "/webhooks/twitch/eventsub") {
    throw new Error("The Twitch callback must use HTTPS and /webhooks/twitch/eventsub");
  }
  return callback.toString();
}

async function twitchRequest(fetcher, apiBaseUrl, path, token, clientId, init = {}) {
  const response = await fetcher(`${apiBaseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Client-Id": clientId,
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
  });
  const payload = response.status === 204 ? {} : await response.json();
  if (!response.ok) {
    throw new Error(
      `Twitch EventSub request failed with status ${response.status}: ${typeof payload?.message === "string" ? payload.message : "unknown error"}`,
    );
  }
  return payload;
}

async function listSubscriptions(fetcher, apiBaseUrl, token, clientId) {
  const subscriptions = [];
  let cursor;
  do {
    const query = new URLSearchParams({ type: "channel.chat.message" });
    if (cursor !== undefined) query.set("after", cursor);
    const payload = await twitchRequest(
      fetcher,
      apiBaseUrl,
      `/eventsub/subscriptions?${query}`,
      token,
      clientId,
    );
    if (Array.isArray(payload.data)) subscriptions.push(...payload.data);
    cursor = typeof payload.pagination?.cursor === "string" ? payload.pagination.cursor : undefined;
  } while (cursor !== undefined);
  return subscriptions;
}

export async function ensureTwitchSubscription({
  environment = process.env,
  fetcher = fetch,
} = {}) {
  const community = await requireCommunityConfig(environment);
  const token = requireValue(environment, "TWITCH_APP_ACCESS_TOKEN");
  const secret = requireValue(environment, "TWITCH_EVENTSUB_SECRET");
  const callback = callbackUrl(environment);
  const apiBaseUrl = (environment.TWITCH_API_BASE_URL ?? "https://api.twitch.tv/helix").replace(
    /\/$/,
    "",
  );
  const subscriptions = await listSubscriptions(
    fetcher,
    apiBaseUrl,
    token,
    community.twitch.clientId,
  );
  const matching = subscriptions.filter(
    (subscription) =>
      subscription.type === "channel.chat.message" &&
      subscription.version === "1" &&
      subscription.condition?.broadcaster_user_id === community.twitch.broadcasterUserId &&
      subscription.condition?.user_id === community.twitch.botUserId,
  );
  const reusable = matching.find(
    (subscription) =>
      subscription.transport?.method === "webhook" &&
      subscription.transport?.callback === callback &&
      ["enabled", "webhook_callback_verification_pending"].includes(subscription.status),
  );

  for (const subscription of matching) {
    if (subscription.id !== reusable?.id && typeof subscription.id === "string") {
      await twitchRequest(
        fetcher,
        apiBaseUrl,
        `/eventsub/subscriptions?id=${encodeURIComponent(subscription.id)}`,
        token,
        community.twitch.clientId,
        { method: "DELETE" },
      );
    }
  }

  if (reusable !== undefined) {
    return { action: "reused", id: reusable.id, status: reusable.status, callback };
  }

  const payload = await twitchRequest(
    fetcher,
    apiBaseUrl,
    "/eventsub/subscriptions",
    token,
    community.twitch.clientId,
    {
      method: "POST",
      body: JSON.stringify({
        type: "channel.chat.message",
        version: "1",
        condition: {
          broadcaster_user_id: community.twitch.broadcasterUserId,
          user_id: community.twitch.botUserId,
        },
        transport: { method: "webhook", callback, secret },
      }),
    },
  );
  const created = Array.isArray(payload.data) ? payload.data[0] : undefined;
  if (typeof created?.id !== "string") throw new Error("Twitch did not return a subscription ID");
  return { action: "created", id: created.id, status: created.status, callback };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const subscription = await ensureTwitchSubscription();
  console.log(JSON.stringify({ action: subscription.action }, null, 2));
}
