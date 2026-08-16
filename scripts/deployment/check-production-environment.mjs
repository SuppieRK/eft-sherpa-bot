import { requireCommunityConfig } from "../community-config.mjs";

function required(name, minimumLength = 1) {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length < minimumLength) {
    throw new Error(`${name} is missing or too short`);
  }
  return value;
}

await requireCommunityConfig();
if (!/^[0-9a-f]{32}$/i.test(required("CLOUDFLARE_ACCOUNT_ID"))) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID must contain 32 hexadecimal characters");
}
if (!/^[0-9a-f-]{36}$/i.test(required("D1_DATABASE_ID"))) {
  throw new Error("D1_DATABASE_ID must be a UUID");
}
required("D1_DATABASE_NAME");
required("WORKER_NAME");
const workerUrl = new URL(required("WORKER_BASE_URL"));
if (workerUrl.protocol !== "https:") throw new Error("WORKER_BASE_URL must use HTTPS");
required("CLOUDFLARE_API_TOKEN", 20);
required("DISCORD_BOT_TOKEN", 20);
required("TWITCH_CLIENT_SECRET", 20);
required("TWITCH_EVENTSUB_SECRET", 32);
required("SPIKE_DIAGNOSTICS_TOKEN", 32);
console.log("The production environment contract is complete.");
