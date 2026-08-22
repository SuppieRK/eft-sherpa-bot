import type { CloudflareEnvironment } from "../cloudflare/environment";
import { requireEnvironmentValue } from "../cloudflare/environment";

export const DISCORD_REQUEST_TIMEOUT_MS = 10_000;

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

function buildDiscordHeaders(environment: CloudflareEnvironment, input?: HeadersInit): Headers {
  const headers = new Headers(input);
  headers.set("Authorization", `Bot ${requireEnvironmentValue(environment, "DISCORD_BOT_TOKEN")}`);
  headers.set("Content-Type", "application/json");
  return headers;
}

function buildInteractionHeaders(input?: HeadersInit): Headers {
  const headers = new Headers(input);
  headers.set("Content-Type", "application/json");
  return headers;
}

async function discordFetch(
  environment: CloudflareEnvironment,
  path: string,
  init: RequestInit,
  authenticate = true,
): Promise<Response> {
  const fetcher =
    environment.DISCORD_API_FETCHER?.fetch.bind(environment.DISCORD_API_FETCHER) ?? fetch;
  const timeoutSignal = AbortSignal.timeout(DISCORD_REQUEST_TIMEOUT_MS);
  const response = await fetcher(`${apiBase(environment)}${path}`, {
    ...init,
    headers: authenticate
      ? buildDiscordHeaders(environment, init.headers)
      : buildInteractionHeaders(init.headers),
    signal: init.signal == null ? timeoutSignal : AbortSignal.any([init.signal, timeoutSignal]),
  });
  if (!response.ok) {
    throw new DiscordApiError(
      response.status,
      response.status === 404 ? "not_found" : "http_error",
    );
  }
  return response;
}

export async function updateDiscordInteractionResponse(
  environment: CloudflareEnvironment,
  applicationId: string,
  interactionToken: string,
  message: unknown,
): Promise<void> {
  await discordFetch(
    environment,
    `/webhooks/${applicationId}/${interactionToken}/messages/@original`,
    { method: "PATCH", body: JSON.stringify(message) },
    false,
  );
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
