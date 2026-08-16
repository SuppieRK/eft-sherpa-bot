import { mkdir, writeFile } from "node:fs/promises";
import { requireCommunityConfig } from "./community-config.mjs";

function required(name) {
  const value = process.env[name];
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing GitHub environment variable: ${name}`);
  }
  return value.trim();
}

const accountId = required("CLOUDFLARE_ACCOUNT_ID");
const databaseId = required("D1_DATABASE_ID");
const databaseName = process.env.D1_DATABASE_NAME?.trim() || "eft-sherpa-bot";
const workerName = process.env.WORKER_NAME?.trim() || "eft-sherpa-bot";
const community = await requireCommunityConfig();

if (!/^[0-9a-f]{32}$/i.test(accountId)) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID must contain 32 hexadecimal characters");
}
if (!/^[0-9a-f-]{36}$/i.test(databaseId)) {
  throw new Error("D1_DATABASE_ID must be a UUID");
}
if (!/^[a-z0-9-]+$/.test(workerName) || !/^[a-z0-9-_]+$/.test(databaseName)) {
  throw new Error("Worker and D1 names contain unsupported characters");
}

const configuration = {
  $schema: "../node_modules/wrangler/config-schema.json",
  name: workerName,
  main: "../src/index.ts",
  compatibility_date: "2026-08-14",
  account_id: accountId,
  workers_dev: true,
  d1_databases: [
    {
      binding: "DB",
      database_name: databaseName,
      database_id: databaseId,
      migrations_dir: "../migrations",
    },
  ],
  vars: {
    APP_ENV: "mvp",
    COMMUNITY_ID: community.communityId,
    TWITCH_BROADCASTER_USER_ID: community.twitch.broadcasterUserId,
    TWITCH_BOT_USER_ID: community.twitch.botUserId,
    TWITCH_CLIENT_ID: community.twitch.clientId,
    DISCORD_APPLICATION_ID: community.discord.applicationId,
    DISCORD_PUBLIC_KEY: community.discord.publicKey,
    DISCORD_GUILD_ID: community.discord.guildId,
    DISCORD_REQUEST_CHANNEL_ID: community.discord.requestChannelId,
    DISCORD_STAFF_CHANNEL_ID: community.discord.staffChannelId,
    DISCORD_VOLUNTEER_ROLE_ID: community.discord.volunteerRoleId,
    DISCORD_STREAMER_USER_ID: community.discord.streamerUserId,
    RECIPIENT_LIMIT: String(community.policies.recipientLimit),
    ATTEMPT_LIMIT: String(community.policies.attemptLimit),
    DISCORD_API_BASE_URL: "https://discord.com/api/v10",
    TWITCH_API_BASE_URL: "https://api.twitch.tv/helix",
    TWITCH_AUTH_BASE_URL: "https://id.twitch.tv/oauth2",
  },
  observability: {
    enabled: true,
    head_sampling_rate: 1,
    logs: { invocation_logs: true, head_sampling_rate: 1 },
  },
};

await mkdir(new URL("../config/", import.meta.url), { recursive: true });
await writeFile(
  new URL("../config/wrangler.github.jsonc", import.meta.url),
  `${JSON.stringify(configuration, null, 2)}\n`,
);
console.log(`Created private deployment configuration for ${workerName}.`);
