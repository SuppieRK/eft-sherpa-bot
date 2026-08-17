import assert from "node:assert/strict";
import { checkedJson } from "./deployment/fetch-json.mjs";
import { WORKER_SECRET_NAMES, workerSecrets } from "./deployment/render-worker-secrets.mjs";
import { waitForWorker } from "./deployment/wait-for-worker.mjs";
import { ensureTwitchSubscription } from "./twitch/create-chat-subscription.mjs";

const environment = {
  COMMUNITY_ID: "butcoffee",
  TWITCH_BROADCASTER_USER_ID: "100000000000001",
  TWITCH_BOT_USER_ID: "100000000000002",
  TWITCH_CLIENT_ID: "testclientid1234567890",
  TWITCH_APP_ACCESS_TOKEN: "application-token",
  TWITCH_EVENTSUB_SECRET: "event-sub-secret-with-at-least-32-bytes",
  WORKER_BASE_URL: "https://worker.example",
  DISCORD_APPLICATION_ID: "200000000000001",
  DISCORD_PUBLIC_KEY: "a".repeat(64),
  DISCORD_GUILD_ID: "200000000000002",
  DISCORD_REQUEST_CHANNEL_ID: "200000000000003",
  DISCORD_STAFF_CHANNEL_ID: "200000000000004",
  DISCORD_VOLUNTEER_ROLE_ID: "200000000000005",
  DISCORD_STREAMER_USER_ID: "200000000000006",
  RECIPIENT_LIMIT: "3",
  ATTEMPT_LIMIT: "3",
};
const callback = "https://worker.example/webhooks/twitch/eventsub";

{
  const secretEnvironment = Object.fromEntries(
    WORKER_SECRET_NAMES.map((name, index) => [name, `secret-${index}`]),
  );
  assert.deepEqual(workerSecrets(secretEnvironment), secretEnvironment);
  assert.throws(
    () => workerSecrets({ ...secretEnvironment, SPIKE_DIAGNOSTICS_TOKEN: "" }),
    /Missing Worker secret: SPIKE_DIAGNOSTICS_TOKEN/,
  );
}

{
  let statusAttempts = 0;
  const waits = [];
  const result = await waitForWorker({
    workerBaseUrl: "https://worker.example",
    diagnosticsToken: "diagnostics-token",
    attempts: 3,
    delayMs: 25,
    fetcher: async (url) => {
      if (new URL(url).pathname === "/health") {
        return Response.json({ status: "ok", configuration: "ready" });
      }
      statusAttempts += 1;
      if (statusAttempts === 1) {
        return new Response("error code: 1101", { status: 500 });
      }
      return Response.json({
        authorization: { ok: true },
        database: { tableCount: 6 },
      });
    },
    sleep: async (duration) => waits.push(duration),
  });
  assert.equal(result.attempt, 2);
  assert.equal(statusAttempts, 2);
  assert.deepEqual(waits, [25]);
}

await assert.rejects(
  waitForWorker({
    workerBaseUrl: "https://worker.example",
    diagnosticsToken: "diagnostics-token",
    attempts: 2,
    delayMs: 0,
    fetcher: async (url) =>
      new URL(url).pathname === "/health"
        ? Response.json({ status: "ok", configuration: "ready" })
        : new Response("error code: 1101", { status: 500 }),
    sleep: async () => undefined,
  }),
  /Worker did not become ready after 2 attempts: \/internal\/status failed with status 500/,
);

{
  const payload = await checkedJson("https://worker.example/health", undefined, async () =>
    Response.json({ status: "ok" }),
  );
  assert.deepEqual(payload, { status: "ok" });

  await assert.rejects(
    checkedJson(
      "https://worker.example/internal/status",
      undefined,
      async () =>
        new Response("<!DOCTYPE html><title>Worker error</title>", {
          status: 500,
          headers: { "Content-Type": "text/html" },
        }),
    ),
    /\/internal\/status failed with status 500 and text\/html: <!DOCTYPE html>/,
  );
}

function response(body, status = 200) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: status === 204 ? {} : { "Content-Type": "application/json" },
  });
}

{
  const requests = [];
  const fetcher = async (url, init = {}) => {
    requests.push({ url: String(url), method: init.method ?? "GET" });
    return response({
      data: [
        {
          id: "existing",
          status: "enabled",
          type: "channel.chat.message",
          version: "1",
          condition: {
            broadcaster_user_id: environment.TWITCH_BROADCASTER_USER_ID,
            user_id: environment.TWITCH_BOT_USER_ID,
          },
          transport: { method: "webhook", callback },
        },
      ],
      pagination: {},
    });
  };
  const result = await ensureTwitchSubscription({ environment, fetcher });
  assert.equal(result.action, "reused");
  assert.deepEqual(
    requests.map((item) => item.method),
    ["GET"],
  );
}

{
  const requests = [];
  const fetcher = async (url, init = {}) => {
    const method = init.method ?? "GET";
    requests.push({ url: String(url), method, body: init.body });
    if (method === "DELETE") return response({}, 204);
    if (method === "POST") {
      const body = JSON.parse(init.body);
      assert.equal(body.transport.secret, environment.TWITCH_EVENTSUB_SECRET);
      return response(
        { data: [{ id: "created", status: "webhook_callback_verification_pending" }] },
        202,
      );
    }
    return response({
      data: [
        {
          id: "obsolete",
          status: "enabled",
          type: "channel.chat.message",
          version: "1",
          condition: {
            broadcaster_user_id: environment.TWITCH_BROADCASTER_USER_ID,
            user_id: environment.TWITCH_BOT_USER_ID,
          },
          transport: {
            method: "webhook",
            callback: "https://old.example/webhooks/twitch/eventsub",
          },
        },
      ],
      pagination: {},
    });
  };
  const result = await ensureTwitchSubscription({ environment, fetcher });
  assert.equal(result.action, "created");
  assert.deepEqual(
    requests.map((item) => item.method),
    ["GET", "DELETE", "POST"],
  );
}

console.log("Deployment helper tests passed.");
