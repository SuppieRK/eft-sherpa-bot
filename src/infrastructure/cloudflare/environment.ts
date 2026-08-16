import type { CommunityEnvironment } from "../../config/community";

export interface CloudflareEnvironment extends CommunityEnvironment {
  APP_ENV: "local" | "mvp";
  DB: D1Database;
  DISCORD_API_BASE_URL?: string;
  DISCORD_API_FETCHER?: Pick<Fetcher, "fetch">;
  DISCORD_BOT_TOKEN?: string;
  TWITCH_API_BASE_URL: string;
  TWITCH_AUTH_BASE_URL: string;
  SPIKE_DIAGNOSTICS_TOKEN?: string;
  TWITCH_APP_ACCESS_TOKEN?: string;
  TWITCH_EVENTSUB_SECRET?: string;
}

export function requireEnvironmentValue(
  environment: CloudflareEnvironment,
  key: keyof CloudflareEnvironment,
): string {
  const value = environment[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required environment binding: ${key}`);
  }
  return value;
}
