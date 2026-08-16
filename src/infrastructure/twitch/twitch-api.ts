import type { CloudflareEnvironment } from "../cloudflare/environment";
import { requireEnvironmentValue } from "../cloudflare/environment";

export interface TwitchApplicationIdentity {
  readonly clientId: string;
  readonly botUserId: string;
}

export class TwitchApiError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
  ) {
    super(`Twitch API request failed: ${code} (${status})`);
    this.name = "TwitchApiError";
  }
}

interface SendChatMessageResponse {
  data?: Array<{
    message_id?: string;
    is_sent?: boolean;
    drop_reason?: { code?: string };
  }>;
}

export async function sendTwitchChatMessage(
  environment: CloudflareEnvironment,
  identity: TwitchApplicationIdentity,
  input: {
    broadcasterId: string;
    message: string;
    replyParentMessageId?: string;
  },
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const response = await fetcher(`${environment.TWITCH_API_BASE_URL}/chat/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requireEnvironmentValue(environment, "TWITCH_APP_ACCESS_TOKEN")}`,
      "Client-Id": identity.clientId,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      broadcaster_id: input.broadcasterId,
      sender_id: identity.botUserId,
      message: input.message,
      ...(input.replyParentMessageId === undefined
        ? {}
        : { reply_parent_message_id: input.replyParentMessageId }),
    }),
  });

  if (!response.ok) {
    throw new TwitchApiError("http_error", response.status);
  }

  const payload = (await response.json()) as SendChatMessageResponse;
  const result = payload.data?.[0];
  if (result?.is_sent !== true || result.message_id === undefined) {
    throw new TwitchApiError(result?.drop_reason?.code ?? "message_not_sent", response.status);
  }
  return result.message_id;
}

export type TwitchAuthorizationHealth =
  | {
      ok: true;
      expiresIn: number;
    }
  | {
      ok: false;
      reason:
        | "revoked_or_expired"
        | "validation_unavailable"
        | "malformed_response"
        | "wrong_client";
    };

interface TwitchValidateResponse {
  client_id?: string;
  expires_in?: number;
}

export async function validateTwitchAuthorization(
  environment: CloudflareEnvironment,
  identity: TwitchApplicationIdentity,
  fetcher: typeof fetch = fetch,
): Promise<TwitchAuthorizationHealth> {
  const response = await fetcher(`${environment.TWITCH_AUTH_BASE_URL}/validate`, {
    headers: {
      Authorization: `OAuth ${requireEnvironmentValue(environment, "TWITCH_APP_ACCESS_TOKEN")}`,
    },
  });

  if (response.status === 401) {
    return { ok: false, reason: "revoked_or_expired" };
  }
  if (!response.ok) {
    return { ok: false, reason: "validation_unavailable" };
  }

  const payload = (await response.json()) as TwitchValidateResponse;
  if (typeof payload.client_id !== "string" || typeof payload.expires_in !== "number") {
    return { ok: false, reason: "malformed_response" };
  }
  if (payload.client_id !== identity.clientId) {
    return { ok: false, reason: "wrong_client" };
  }
  return {
    ok: true,
    expiresIn: payload.expires_in,
  };
}
