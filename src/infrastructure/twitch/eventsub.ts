const MESSAGE_ID_HEADER = "Twitch-Eventsub-Message-Id";
const MESSAGE_TIMESTAMP_HEADER = "Twitch-Eventsub-Message-Timestamp";
const MESSAGE_SIGNATURE_HEADER = "Twitch-Eventsub-Message-Signature";
const MESSAGE_TYPE_HEADER = "Twitch-Eventsub-Message-Type";
const SUBSCRIPTION_TYPE_HEADER = "Twitch-Eventsub-Subscription-Type";
const MAX_MESSAGE_AGE_MS = 10 * 60 * 1000;

const hmacKeyCache = createLastValueAsyncCache((secret: string) =>
  crypto.subtle.importKey(
    "raw",
    sharedTextEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  ),
);

interface TwitchEventSubHeaders {
  messageId: string;
  messageTimestamp: string;
  messageSignature: string;
  messageType: string;
  subscriptionType?: string;
}

export interface TwitchChatMessageEvent {
  broadcasterUserId: string;
  chatterUserId: string;
  chatterUserLogin: string;
  messageId: string;
  text: string;
}

export type EventSubVerificationResult =
  | { ok: true; headers: TwitchEventSubHeaders }
  | {
      ok: false;
      reason: "missing_headers" | "invalid_timestamp" | "stale_timestamp" | "invalid_signature";
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function readTwitchEventSubHeaders(headers: Headers): TwitchEventSubHeaders | undefined {
  const messageId = headers.get(MESSAGE_ID_HEADER);
  const messageTimestamp = headers.get(MESSAGE_TIMESTAMP_HEADER);
  const messageSignature = headers.get(MESSAGE_SIGNATURE_HEADER);
  const messageType = headers.get(MESSAGE_TYPE_HEADER);

  if (!(messageId && messageTimestamp && messageSignature && messageType)) {
    return undefined;
  }

  const subscriptionType = headers.get(SUBSCRIPTION_TYPE_HEADER) ?? undefined;
  return {
    messageId,
    messageTimestamp,
    messageSignature,
    messageType,
    ...(subscriptionType === undefined ? {} : { subscriptionType }),
  };
}

export async function createTwitchEventSubSignature(
  secret: string,
  messageId: string,
  timestamp: string,
  rawBody: string,
): Promise<string> {
  const key = await hmacKeyCache.get(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    sharedTextEncoder.encode(`${messageId}${timestamp}${rawBody}`),
  );
  const hex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `sha256=${hex}`;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = sharedTextEncoder.encode(left);
  const rightBytes = sharedTextEncoder.encode(right);
  const length = Math.max(leftBytes.length, rightBytes.length);
  let mismatch = leftBytes.length ^ rightBytes.length;

  for (let index = 0; index < length; index += 1) {
    mismatch |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }

  return mismatch === 0;
}

export async function verifyTwitchEventSubRequest(
  requestHeaders: Headers,
  rawBody: string,
  secret: string,
  now: Date,
): Promise<EventSubVerificationResult> {
  const headers = readTwitchEventSubHeaders(requestHeaders);
  if (headers === undefined) {
    return { ok: false, reason: "missing_headers" };
  }

  const sentAt = Date.parse(headers.messageTimestamp);
  if (!Number.isFinite(sentAt)) {
    return { ok: false, reason: "invalid_timestamp" };
  }
  if (Math.abs(now.getTime() - sentAt) > MAX_MESSAGE_AGE_MS) {
    return { ok: false, reason: "stale_timestamp" };
  }

  const expectedSignature = await createTwitchEventSubSignature(
    secret,
    headers.messageId,
    headers.messageTimestamp,
    rawBody,
  );
  if (!constantTimeEqual(expectedSignature, headers.messageSignature)) {
    return { ok: false, reason: "invalid_signature" };
  }

  return { ok: true, headers };
}

export function parseTwitchChatMessageEvent(payload: unknown): TwitchChatMessageEvent | undefined {
  if (!isRecord(payload) || !isRecord(payload.event)) {
    return undefined;
  }

  const event = payload.event;
  const message = event.message;
  if (!isRecord(message)) {
    return undefined;
  }

  const broadcasterUserId = requiredString(event, "broadcaster_user_id");
  const chatterUserId = requiredString(event, "chatter_user_id");
  const chatterUserLogin = requiredString(event, "chatter_user_login");
  const messageId = requiredString(event, "message_id");
  const text = requiredString(message, "text");

  if (!(broadcasterUserId && chatterUserId && chatterUserLogin && messageId && text)) {
    return undefined;
  }

  return { broadcasterUserId, chatterUserId, chatterUserLogin, messageId, text };
}

export function parseEventSubChallenge(payload: unknown): string | undefined {
  return isRecord(payload) ? requiredString(payload, "challenge") : undefined;
}
import { createLastValueAsyncCache, sharedTextEncoder } from "../crypto-key-cache";
