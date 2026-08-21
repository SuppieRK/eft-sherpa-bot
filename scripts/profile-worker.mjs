import { spawn, spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const PROFILE_DIRECTORY = path.join(ROOT, ".artifacts", "worker-profile");
const CONFIG_PATH = path.join(PROFILE_DIRECTORY, "wrangler.jsonc");
const FIXTURE_PATH = path.join(PROFILE_DIRECTORY, "fixture.json");
const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const DEFAULT_REPLAY_COUNT = 100;
const MOCK_API_PORT = 8788;

function encodeHex(value) {
  return Buffer.from(value).toString("hex");
}

function encodeBase64(value) {
  return Buffer.from(value).toString("base64");
}

function decodeBase64(value) {
  return Buffer.from(value, "base64");
}

async function prepare() {
  await mkdir(PROFILE_DIRECTORY, { recursive: true });
  const keyPair = await crypto.subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  const publicKey = await crypto.subtle.exportKey("raw", keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey("pkcs8", keyPair.privateKey);
  const eventSubSecret = encodeHex(crypto.getRandomValues(new Uint8Array(32)));
  const fixture = {
    applicationId: "200000000000001",
    eventSubSecret,
    privateKey: encodeBase64(privateKey),
  };
  const configuration = {
    $schema: path.relative(
      PROFILE_DIRECTORY,
      path.join(ROOT, "node_modules/wrangler/config-schema.json"),
    ),
    name: "coffee-bot-profile-local",
    main: path.relative(PROFILE_DIRECTORY, path.join(ROOT, "src/index.ts")),
    compatibility_date: "2026-08-14",
    d1_databases: [
      {
        binding: "DB",
        database_name: "coffee-bot-profile-local",
        database_id: "00000000-0000-0000-0000-000000000000",
        migrations_dir: path.relative(PROFILE_DIRECTORY, path.join(ROOT, "migrations")),
      },
    ],
    vars: {
      APP_ENV: "local",
      COMMUNITY_ID: "butcoffee",
      TWITCH_BROADCASTER_USER_ID: "100000000000001",
      TWITCH_BOT_USER_ID: "100000000000002",
      TWITCH_CLIENT_ID: "profileclient1234567890",
      TWITCH_EVENTSUB_SECRET: eventSubSecret,
      DISCORD_APPLICATION_ID: fixture.applicationId,
      DISCORD_PUBLIC_KEY: encodeHex(publicKey),
      DISCORD_GUILD_ID: "200000000000002",
      DISCORD_REQUEST_CHANNEL_ID: "200000000000003",
      DISCORD_STAFF_CHANNEL_ID: "200000000000004",
      DISCORD_VOLUNTEER_ROLE_ID: "200000000000005",
      DISCORD_STREAMER_USER_ID: "200000000000006",
      RECIPIENT_LIMIT: "4",
      ATTEMPT_LIMIT: "3",
      SPIKE_DIAGNOSTICS_TOKEN: encodeHex(crypto.getRandomValues(new Uint8Array(32))),
      DISCORD_API_BASE_URL: `http://127.0.0.1:${MOCK_API_PORT}/discord`,
      DISCORD_BOT_TOKEN: "profile-discord-token",
      TWITCH_API_BASE_URL: `http://127.0.0.1:${MOCK_API_PORT}/twitch`,
      TWITCH_AUTH_BASE_URL: `http://127.0.0.1:${MOCK_API_PORT}/twitch-auth`,
      TWITCH_APP_ACCESS_TOKEN: "profile-twitch-token",
    },
  };
  await Promise.all([
    writeFile(CONFIG_PATH, `${JSON.stringify(configuration, null, 2)}\n`),
    writeFile(FIXTURE_PATH, `${JSON.stringify(fixture, null, 2)}\n`, { mode: 0o600 }),
  ]);
  return { configPath: CONFIG_PATH, fixturePath: FIXTURE_PATH };
}

async function signedTwitchRequest(baseUrl, fixture, input) {
  const { messageId, body, messageType, subscriptionType } = input;
  const timestamp = new Date().toISOString();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(fixture.eventSubSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${messageId}${timestamp}${body}`),
  );
  return fetch(new URL("/webhooks/twitch/eventsub", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Twitch-Eventsub-Message-Id": messageId,
      "Twitch-Eventsub-Message-Timestamp": timestamp,
      "Twitch-Eventsub-Message-Signature": `sha256=${encodeHex(signature)}`,
      "Twitch-Eventsub-Message-Type": messageType,
      "Twitch-Eventsub-Subscription-Type": subscriptionType,
    },
    body,
  });
}

function twitchChallengeRequest(baseUrl, fixture, index) {
  return signedTwitchRequest(baseUrl, fixture, {
    messageId: `profile-twitch-challenge-${index}`,
    messageType: "webhook_callback_verification",
    subscriptionType: "channel.chat.message",
    body: JSON.stringify({
      challenge: `profile-challenge-${index}`,
      subscription: { type: "channel.chat.message" },
    }),
  });
}

function twitchCommandRequest(baseUrl, fixture, index, text, suffix, userSuffix = String(index)) {
  return signedTwitchRequest(baseUrl, fixture, {
    messageId: `profile-twitch-${suffix}-${index}`,
    messageType: "notification",
    subscriptionType: "channel.chat.message",
    body: JSON.stringify({
      subscription: { type: "channel.chat.message" },
      event: {
        broadcaster_user_id: "100000000000001",
        broadcaster_user_login: "butcoffee",
        chatter_user_id: `profile-twitch-user-${userSuffix}`,
        chatter_user_login: `profile_viewer_${userSuffix}`,
        message_id: `profile-chat-${suffix}-${index}`,
        message: { text },
      },
    }),
  });
}

async function signedDiscordRequest(baseUrl, fixture, body) {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const rawBody = JSON.stringify(body);
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    decodeBase64(fixture.privateKey),
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "Ed25519",
    privateKey,
    new TextEncoder().encode(`${timestamp}${rawBody}`),
  );
  return fetch(new URL("/webhooks/discord/interactions", baseUrl), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature-Ed25519": encodeHex(signature),
      "X-Signature-Timestamp": timestamp,
    },
    body: rawBody,
  });
}

function discordPingRequest(baseUrl, fixture, index) {
  return signedDiscordRequest(baseUrl, fixture, {
    id: `profile-discord-ping-${index}`,
    application_id: fixture.applicationId,
    type: 1,
    token: "profile-token",
    version: 1,
  });
}

function discordBoardRequest(baseUrl, fixture, index) {
  return signedDiscordRequest(baseUrl, fixture, {
    id: `profile-discord-board-${index}`,
    application_id: fixture.applicationId,
    guild_id: "200000000000002",
    channel_id: "200000000000004",
    type: 2,
    token: "profile-token",
    version: 1,
    member: {
      user: { id: "200000000000006", username: "Profile Streamer" },
      roles: [],
    },
    data: { type: 1, name: "board" },
  });
}

async function startMockApi() {
  let messageSequence = 0;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    if (request.url?.startsWith("/twitch/chat/messages") === true) {
      response.end(
        JSON.stringify({
          data: [{ message_id: `profile-twitch-reply-${++messageSequence}`, is_sent: true }],
        }),
      );
      return;
    }
    response.end(JSON.stringify({ id: `profile-discord-message-${++messageSequence}` }));
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(MOCK_API_PORT, "127.0.0.1", resolve);
  });
  return server;
}

async function replay() {
  const fixture = JSON.parse(await readFile(FIXTURE_PATH, "utf8"));
  const count = Number(process.argv[3] ?? DEFAULT_REPLAY_COUNT);
  const baseUrl = process.env.WORKER_PROFILE_BASE_URL ?? DEFAULT_BASE_URL;
  if (!Number.isInteger(count) || count <= 0) throw new Error("Replay count must be positive");
  const mockApi = await startMockApi();
  try {
    for (let index = 0; index < count; index += 1) {
      const requests = [
        () => twitchChallengeRequest(baseUrl, fixture, index),
        () => discordPingRequest(baseUrl, fixture, index),
        () =>
          twitchCommandRequest(
            baseUrl,
            fixture,
            index,
            "!request pve customs Profile task",
            "request",
          ),
        () =>
          twitchCommandRequest(
            baseUrl,
            fixture,
            index,
            "!request pve",
            "invalid",
            `invalid-${index}`,
          ),
        () => twitchCommandRequest(baseUrl, fixture, index, "!queue", "queue"),
        () => discordBoardRequest(baseUrl, fixture, index),
      ];
      for (const send of requests) {
        // The replay preserves the user workflow and keeps D1 transitions deterministic.
        const response = await send();
        if (!response.ok) {
          throw new Error(`Profile request failed at ${index} with status ${response.status}`);
        }
      }
    }
  } finally {
    await new Promise((resolve, reject) => {
      mockApi.close((error) => (error === undefined ? resolve() : reject(error)));
    });
  }
  console.log(`Replayed ${count} complete signed Worker request sets.`);
}

async function serve() {
  const paths = await prepare();
  const wranglerPath = path.join(ROOT, "node_modules", "wrangler", "bin", "wrangler.js");
  const migration = spawnSync(
    process.execPath,
    [
      wranglerPath,
      "d1",
      "migrations",
      "apply",
      "coffee-bot-profile-local",
      "--local",
      "--config",
      paths.configPath,
    ],
    { cwd: ROOT, encoding: "utf8", env: { ...process.env, CI: "true" } },
  );
  if (migration.status !== 0) {
    process.stdout.write(migration.stdout ?? "");
    process.stderr.write(migration.stderr ?? "");
    throw new Error("Local profile migrations failed");
  }
  console.log(`Generated local profile state in ${PROFILE_DIRECTORY}.`);
  console.log(
    "Press D after Wrangler starts, select Profiler, and then run npm run profile:replay.",
  );
  const child = spawn(
    process.execPath,
    [
      wranglerPath,
      "dev",
      "--config",
      paths.configPath,
      "--port",
      "8787",
      "--inspector-port",
      "9229",
      "--latest=false",
    ],
    { cwd: ROOT, stdio: "inherit" },
  );
  await new Promise((resolve, reject) => {
    child.once("exit", (code, signal) => {
      if (code === 0 || signal === "SIGINT") resolve();
      else reject(new Error(`Wrangler stopped with code ${String(code)} and signal ${signal}`));
    });
    child.once("error", reject);
  });
}

const command = process.argv[2];
if (command === "prepare") {
  const paths = await prepare();
  console.log(`Generated ${paths.configPath} and ${paths.fixturePath}.`);
} else if (command === "serve") {
  await serve();
} else if (command === "replay") {
  await replay();
} else {
  throw new Error("Use profile-worker.mjs with prepare, serve, or replay");
}
