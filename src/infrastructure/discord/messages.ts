import type { CloudflareEnvironment } from "../cloudflare/environment";
import { requireEnvironmentValue } from "../cloudflare/environment";

export class DiscordApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`Discord API request failed: ${code} (${status})`);
    this.name = "DiscordApiError";
  }
}

function apiBase(environment: CloudflareEnvironment): string {
  return environment.DISCORD_API_BASE_URL?.replace(/\/$/, "") ?? "https://discord.com/api/v10";
}

export function buildDiscordHeaders(
  environment: CloudflareEnvironment,
  input?: HeadersInit,
): Headers {
  const headers = new Headers(input);
  headers.set("Authorization", `Bot ${requireEnvironmentValue(environment, "DISCORD_BOT_TOKEN")}`);
  headers.set("Content-Type", "application/json");
  return headers;
}

async function discordFetch(
  environment: CloudflareEnvironment,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const fetcher =
    environment.DISCORD_API_FETCHER?.fetch.bind(environment.DISCORD_API_FETCHER) ?? fetch;
  const response = await fetcher(`${apiBase(environment)}${path}`, {
    ...init,
    headers: buildDiscordHeaders(environment, init.headers),
  });
  if (!response.ok) {
    throw new DiscordApiError(
      response.status,
      response.status === 404 ? "not_found" : "http_error",
    );
  }
  return response;
}

async function discordRequest(
  environment: CloudflareEnvironment,
  path: string,
  init: RequestInit,
): Promise<{ id: string }> {
  const response = await discordFetch(environment, path, init);
  const body = (await response.json()) as { id?: unknown };
  if (typeof body.id !== "string") throw new DiscordApiError(response.status, "malformed_response");
  return { id: body.id };
}

export async function deleteDiscordMessage(
  environment: CloudflareEnvironment,
  channelId: string,
  messageId: string,
): Promise<void> {
  await discordFetch(environment, `/channels/${channelId}/messages/${messageId}`, {
    method: "DELETE",
  });
}

export function getDiscordMessage(
  environment: CloudflareEnvironment,
  channelId: string,
  messageId: string,
): Promise<{ id: string }> {
  return discordRequest(environment, `/channels/${channelId}/messages/${messageId}`, {
    method: "GET",
  });
}

export function createDiscordMessage(
  environment: CloudflareEnvironment,
  channelId: string,
  message: unknown,
): Promise<{ id: string }> {
  return discordRequest(environment, `/channels/${channelId}/messages`, {
    method: "POST",
    body: JSON.stringify(message),
  });
}

export function updateDiscordMessage(
  environment: CloudflareEnvironment,
  channelId: string,
  messageId: string,
  message: unknown,
): Promise<{ id: string }> {
  return discordRequest(environment, `/channels/${channelId}/messages/${messageId}`, {
    method: "PATCH",
    body: JSON.stringify(message),
  });
}

export function discordMessageUrl(guildId: string, channelId: string, messageId: string): string {
  return `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;
}
