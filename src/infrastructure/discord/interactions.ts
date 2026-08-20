const SIGNATURE_HEADER = "X-Signature-Ed25519";
const TIMESTAMP_HEADER = "X-Signature-Timestamp";
const MAX_INTERACTION_AGE_MS = 10 * 60 * 1_000;

const DISCORD_INTERACTION_PING = 1;
const DISCORD_INTERACTION_APPLICATION_COMMAND = 2;
const DISCORD_INTERACTION_MESSAGE_COMPONENT = 3;
const DISCORD_INTERACTION_MODAL_SUBMIT = 5;
export const DISCORD_INTERACTION_RESPONSE_PONG = 1;
export const DISCORD_INTERACTION_RESPONSE_CHANNEL_MESSAGE = 4;
export const DISCORD_INTERACTION_RESPONSE_UPDATE_MESSAGE = 7;
export const DISCORD_INTERACTION_RESPONSE_MODAL = 9;
export const DISCORD_EPHEMERAL_MESSAGE_FLAG = 64;

interface DiscordInteractionContext {
  interactionId: string;
  applicationId: string;
  guildId: string;
  channelId: string;
  discordUserId: string;
  discordDisplayName?: string;
  discordRoleIds: readonly string[];
}

export interface DiscordApplicationCommandInteraction extends DiscordInteractionContext {
  type: "application_command";
  commandName: string;
  options: Readonly<Record<string, string>>;
  resolvedUserDisplayNames: Readonly<Record<string, string>>;
}

interface DiscordModalSubmitInteraction extends DiscordInteractionContext {
  type: "modal_submit";
  customId: string;
  values: Readonly<Record<string, string>>;
}

export interface DiscordMessageComponentInteraction extends DiscordInteractionContext {
  type: "message_component";
  customId: string;
  messageId?: string;
  values: readonly string[];
  resolvedRoleIdsByUser: Readonly<Record<string, readonly string[]>>;
}

export type ParsedDiscordInteraction =
  | { type: "ping" }
  | DiscordApplicationCommandInteraction
  | DiscordMessageComponentInteraction
  | DiscordModalSubmitInteraction;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function parseContext(payload: Record<string, unknown>): DiscordInteractionContext | undefined {
  const member = payload.member;
  if (!isRecord(member) || !isRecord(member.user)) {
    return undefined;
  }
  const interactionId = requiredString(payload, "id");
  const applicationId = requiredString(payload, "application_id");
  const guildId = requiredString(payload, "guild_id");
  const channelId = requiredString(payload, "channel_id");
  const discordUserId = requiredString(member.user, "id");
  if (!(interactionId && applicationId && guildId && channelId && discordUserId)) {
    return undefined;
  }
  const discordRoleIds = Array.isArray(member.roles)
    ? member.roles.filter((role): role is string => typeof role === "string")
    : [];
  const discordDisplayName =
    requiredString(member, "nick") ??
    requiredString(member.user, "global_name") ??
    requiredString(member.user, "username");
  return {
    interactionId,
    applicationId,
    guildId,
    channelId,
    discordUserId,
    ...(discordDisplayName === undefined ? {} : { discordDisplayName }),
    discordRoleIds,
  };
}

function parseResolvedUserDisplayNames(
  data: Record<string, unknown>,
): Readonly<Record<string, string>> {
  if (!isRecord(data.resolved) || !isRecord(data.resolved.users)) {
    return {};
  }
  const members = isRecord(data.resolved.members) ? data.resolved.members : {};
  const result: Record<string, string> = {};
  for (const [userId, user] of Object.entries(data.resolved.users)) {
    if (!isRecord(user)) {
      continue;
    }
    const member = members[userId];
    const displayName =
      (isRecord(member) ? requiredString(member, "nick") : undefined) ??
      requiredString(user, "global_name") ??
      requiredString(user, "username");
    if (displayName !== undefined) {
      result[userId] = displayName;
    }
  }
  return result;
}

function parseResolvedRoleIds(data: Record<string, unknown>): Readonly<Record<string, string[]>> {
  if (!isRecord(data.resolved) || !isRecord(data.resolved.members)) {
    return {};
  }
  const result: Record<string, string[]> = {};
  for (const [userId, member] of Object.entries(data.resolved.members)) {
    if (isRecord(member) && Array.isArray(member.roles)) {
      result[userId] = member.roles.filter((role): role is string => typeof role === "string");
    }
  }
  return result;
}

function collectModalValues(component: unknown, values: Record<string, string>): void {
  if (!isRecord(component)) {
    return;
  }
  const customId = requiredString(component, "custom_id");
  if (customId !== undefined && typeof component.value === "string") {
    values[customId] = component.value;
  }
  if (
    customId !== undefined &&
    Array.isArray(component.values) &&
    component.values.length === 1 &&
    typeof component.values[0] === "string"
  ) {
    values[customId] = component.values[0];
  }
  collectModalValues(component.component, values);
  if (Array.isArray(component.components)) {
    for (const child of component.components) {
      collectModalValues(child, values);
    }
  }
}

function parseCommandOptions(data: Record<string, unknown>): Readonly<Record<string, string>> {
  const options: Record<string, string> = {};
  if (!Array.isArray(data.options)) {
    return options;
  }
  for (const option of data.options) {
    if (!isRecord(option)) {
      continue;
    }
    const name = requiredString(option, "name");
    if (name !== undefined && typeof option.value === "string") {
      options[name] = option.value;
    }
  }
  return options;
}

function decodeHex(value: string, expectedBytes: number): Uint8Array | undefined {
  if (value.length !== expectedBytes * 2 || !/^[0-9a-f]+$/i.test(value)) {
    return undefined;
  }
  const bytes = new Uint8Array(expectedBytes);
  for (let index = 0; index < expectedBytes; index += 1) {
    bytes[index] = Number.parseInt(value.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export async function verifyDiscordInteractionRequest(
  headers: Headers,
  rawBody: string,
  publicKeyHex: string,
  now: Date,
): Promise<boolean> {
  const signatureHex = headers.get(SIGNATURE_HEADER);
  const timestamp = headers.get(TIMESTAMP_HEADER);
  const publicKey = decodeHex(publicKeyHex, 32);
  const signature = signatureHex === null ? undefined : decodeHex(signatureHex, 64);
  if (timestamp === null || publicKey === undefined || signature === undefined) {
    return false;
  }
  const sentAt = Number(timestamp) * 1_000;
  if (!Number.isFinite(sentAt) || Math.abs(now.getTime() - sentAt) > MAX_INTERACTION_AGE_MS) {
    return false;
  }

  try {
    const key = await crypto.subtle.importKey("raw", publicKey, { name: "Ed25519" }, false, [
      "verify",
    ]);
    return await crypto.subtle.verify(
      "Ed25519",
      key,
      signature,
      new TextEncoder().encode(`${timestamp}${rawBody}`),
    );
  } catch {
    return false;
  }
}

export function parseDiscordInteraction(payload: unknown): ParsedDiscordInteraction | undefined {
  if (!isRecord(payload) || typeof payload.type !== "number") {
    return undefined;
  }
  if (payload.type === DISCORD_INTERACTION_PING) {
    return { type: "ping" };
  }
  if (!isRecord(payload.data)) {
    return undefined;
  }
  const context = parseContext(payload);
  if (context === undefined) {
    return undefined;
  }
  if (payload.type === DISCORD_INTERACTION_APPLICATION_COMMAND) {
    const commandName = requiredString(payload.data, "name");
    return commandName === undefined
      ? undefined
      : {
          type: "application_command",
          ...context,
          commandName,
          options: parseCommandOptions(payload.data),
          resolvedUserDisplayNames: parseResolvedUserDisplayNames(payload.data),
        };
  }
  if (payload.type === DISCORD_INTERACTION_MESSAGE_COMPONENT) {
    const customId = requiredString(payload.data, "custom_id");
    const messageId = isRecord(payload.message) ? requiredString(payload.message, "id") : undefined;
    const values = Array.isArray(payload.data.values)
      ? payload.data.values.filter((value): value is string => typeof value === "string")
      : [];
    return customId === undefined
      ? undefined
      : {
          type: "message_component",
          ...context,
          customId,
          ...(messageId === undefined ? {} : { messageId }),
          values,
          resolvedRoleIdsByUser: parseResolvedRoleIds(payload.data),
        };
  }
  if (payload.type !== DISCORD_INTERACTION_MODAL_SUBMIT) {
    return undefined;
  }
  const customId = requiredString(payload.data, "custom_id");
  if (customId === undefined || !Array.isArray(payload.data.components)) {
    return undefined;
  }
  const values: Record<string, string> = {};
  for (const component of payload.data.components) {
    collectModalValues(component, values);
  }
  return {
    type: "modal_submit",
    ...context,
    customId,
    values,
  };
}

export function readDiscordInteractionTimestamp(headers: Headers): Date {
  const seconds = Number(headers.get(TIMESTAMP_HEADER));
  return Number.isFinite(seconds) ? new Date(seconds * 1_000) : new Date();
}
