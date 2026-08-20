import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import type { createWorker } from "../src";
import type { CommunityConfig } from "../src/config/community";
import { TARKOV_MAPS } from "../src/domain/maps/catalog";
import { createTwitchEventSubSignature } from "../src/infrastructure/twitch/eventsub";
import type { CloudflareEnvironment } from "../src/infrastructure/cloudflare/environment";

const SORT_STEP = 1_000_000;
const BASE_SORT_OFFSET = 100;
const SEED_CHUNK_SIZE = 1_000;
const RECEIPT_PREFIX = "seed-receipt-";
export const OPERATION_PREFIX = "bench-op-";

export interface SeedState {
  scale: number;
  groupCount: number;
  membershipCount: number;
  priorityMaxSortKey: number;
  ordinaryMaxSortKey: number;
  databaseBytes: number;
}

interface GroupSeed {
  gameMode: number;
  id: number;
  isPriority: number;
  sortKey: number;
  mapId: string;
  capacity: number;
  automaticFill: number;
}

interface RequestSeed {
  gameMode: number;
  id: number;
  groupId: number;
  position: number;
  isPriority: number;
  mapId: string;
}

function jsonRows<T>(rows: readonly T[]): string {
  return JSON.stringify(rows);
}

async function clearDatabase(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM raid_group_members"),
    env.DB.prepare("DELETE FROM raid_groups"),
    env.DB.prepare("DELETE FROM help_requests"),
    env.DB.prepare("DELETE FROM user_mappings"),
    env.DB.prepare("DELETE FROM community_state"),
    env.DB.prepare("DELETE FROM event_receipts"),
    env.DB.prepare(
      "DELETE FROM sqlite_sequence WHERE name IN ('help_requests', 'raid_groups', 'raid_group_members')",
    ),
  ]);
}

async function insertSeedChunk(
  requests: readonly RequestSeed[],
  groups: readonly GroupSeed[],
  timestamp: number,
): Promise<number> {
  const requestJson = jsonRows(requests);
  const results = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO raid_groups
       (id, is_priority, game_mode, sort_key, map_id, requester_capacity, automatic_fill,
        created_at, updated_at)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.isPriority'),
              json_extract(value, '$.gameMode'), json_extract(value, '$.sortKey'),
              json_extract(value, '$.mapId'),
              json_extract(value, '$.capacity'), json_extract(value, '$.automaticFill'), ?, ?
       FROM json_each(?)`,
    ).bind(timestamp, timestamp, jsonRows(groups)),
    env.DB.prepare(
      `INSERT INTO user_mappings
       (twitch_login, twitch_user_id, discord_user_id, in_game_name, created_at, updated_at)
       SELECT printf('bench_%06d', json_extract(value, '$.id')),
              printf('bench-twitch-%d', json_extract(value, '$.id')),
              printf('bench-discord-%d', json_extract(value, '$.id')),
              printf('PMC %d', json_extract(value, '$.id')), ?, ?
       FROM json_each(?)`,
    ).bind(timestamp, timestamp, requestJson),
    env.DB.prepare(
      `INSERT INTO help_requests
       (id, source_platform, source_delivery_id, discord_user_id, twitch_user_id,
        twitch_login, in_game_name, game_mode, map_id, objective, is_priority, state,
        created_at, updated_at)
       SELECT json_extract(value, '$.id'), 1,
              printf('seed-request-%d', json_extract(value, '$.id')),
              printf('bench-discord-%d', json_extract(value, '$.id')),
              printf('bench-twitch-%d', json_extract(value, '$.id')),
              printf('bench_%06d', json_extract(value, '$.id')),
              printf('PMC %d', json_extract(value, '$.id')),
              json_extract(value, '$.gameMode'),
              json_extract(value, '$.mapId'),
              printf('Seeded goal %d', json_extract(value, '$.id')),
              json_extract(value, '$.isPriority'), 1, ?, ?
       FROM json_each(?)`,
    ).bind(timestamp, timestamp, requestJson),
    env.DB.prepare(
      `INSERT INTO raid_group_members
       (id, group_id, request_id, position, created_at, updated_at)
       SELECT json_extract(value, '$.id'), json_extract(value, '$.groupId'),
              json_extract(value, '$.id'), json_extract(value, '$.position'), ?, ?
       FROM json_each(?)`,
    ).bind(timestamp, timestamp, requestJson),
    env.DB.prepare(
      `INSERT INTO event_receipts (platform, delivery_id, event_type, received_at)
       SELECT json_extract(value, '$.id') % 2,
              printf('${RECEIPT_PREFIX}%d', json_extract(value, '$.id')), 'seed', ?
       FROM json_each(?)`,
    ).bind(timestamp, requestJson),
  ]);
  return Number(results.at(-1)?.meta.size_after ?? 0);
}

export async function seedDatabase(scale: number): Promise<SeedState> {
  await clearDatabase();
  const timestamp = Date.now();
  const priorityRequestCount = Math.floor(scale / 5);
  let requestId = 1;
  let groupId = 0;
  let priorityOrdinal = 0;
  let ordinaryOrdinal = 0;
  let mapIndex = 0;
  let requestChunk: RequestSeed[] = [];
  let groupChunk: GroupSeed[] = [];
  let databaseBytes = 0;
  while (requestId <= scale) {
    const isPriority = requestId <= priorityRequestCount ? 1 : 0;
    const segmentEnd = isPriority === 1 ? priorityRequestCount : scale;
    const map = TARKOV_MAPS[mapIndex % TARKOV_MAPS.length];
    if (map === undefined) throw new Error("The Tarkov map catalog is empty.");
    const capacity = Math.min(3, map.sherpaPartyCapacity - 1);
    const memberCount = Math.min(capacity, segmentEnd - requestId + 1);
    groupId += 1;
    const gameMode = [2, 2, 2, 2, 2, 2, 2, 1, 1, 0][(groupId - 1) % 10] as number;
    mapIndex += 1;
    if (isPriority === 1) priorityOrdinal += 1;
    else ordinaryOrdinal += 1;
    groupChunk.push({
      id: groupId,
      gameMode,
      isPriority,
      sortKey:
        ((isPriority === 1 ? priorityOrdinal : ordinaryOrdinal) + BASE_SORT_OFFSET) * SORT_STEP,
      mapId: map.id,
      capacity,
      automaticFill: memberCount === capacity ? 1 : 0,
    });
    for (let position = 1; position <= memberCount; position += 1) {
      requestChunk.push({
        id: requestId,
        gameMode,
        groupId,
        position,
        isPriority,
        mapId: map.id,
      });
      requestId += 1;
    }
    if (requestChunk.length >= SEED_CHUNK_SIZE || requestId > scale) {
      databaseBytes = await insertSeedChunk(requestChunk, groupChunk, timestamp);
      requestChunk = [];
      groupChunk = [];
    }
  }
  const communityResult = await env.DB.prepare(
    `INSERT INTO community_state
     (community_id, staff_board_message_id, created_at, updated_at)
     VALUES ('butcoffee', 'benchmark-canonical-board', ?, ?)`,
  )
    .bind(timestamp, timestamp)
    .run();
  databaseBytes = Number(communityResult.meta.size_after ?? databaseBytes);
  return {
    scale,
    groupCount: groupId,
    membershipCount: scale,
    priorityMaxSortKey: (priorityOrdinal + BASE_SORT_OFFSET) * SORT_STEP,
    ordinaryMaxSortKey: (ordinaryOrdinal + BASE_SORT_OFFSET) * SORT_STEP,
    databaseBytes,
  };
}

export async function resetOperationFixture(seed: SeedState): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM raid_group_members WHERE request_id > ? OR group_id > ?").bind(
      seed.scale,
      seed.groupCount,
    ),
    env.DB.prepare("DELETE FROM raid_groups WHERE id > ?").bind(seed.groupCount),
    env.DB.prepare("DELETE FROM help_requests WHERE id > ?").bind(seed.scale),
    env.DB.prepare("DELETE FROM user_mappings WHERE twitch_login LIKE 'op\\_%' ESCAPE '\\'"),
    env.DB.prepare("DELETE FROM event_receipts WHERE delivery_id LIKE 'bench-op-%'"),
    env.DB.prepare(
      `UPDATE community_state SET staff_board_message_id = 'benchmark-canonical-board', updated_at = ?
       WHERE community_id = 'butcoffee'`,
    ).bind(Date.now()),
    env.DB.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'help_requests'").bind(
      seed.scale,
    ),
    env.DB.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'raid_groups'").bind(
      seed.groupCount,
    ),
    env.DB.prepare("UPDATE sqlite_sequence SET seq = ? WHERE name = 'raid_group_members'").bind(
      seed.membershipCount,
    ),
  ]);
}

export async function seedOperationMapping(input: {
  suffix: string;
  discordUserId?: string;
  twitchUserId?: string;
}): Promise<void> {
  const timestamp = Date.now();
  await env.DB.prepare(
    `INSERT INTO user_mappings
     (twitch_login, twitch_user_id, discord_user_id, discord_display_name,
      in_game_name, created_at, updated_at)
     VALUES (?, ?, ?, 'Benchmark Viewer', 'Benchmark PMC', ?, ?)`,
  )
    .bind(
      `op_${input.suffix}`,
      input.twitchUserId ?? null,
      input.discordUserId ?? null,
      timestamp,
      timestamp,
    )
    .run();
}

export async function seedOperationRaid(input: {
  seed: SeedState;
  suffix: string;
  memberCount: number;
  state: "planned" | "active";
  streamerDiscordUserId: string;
  isPriority?: boolean;
  visibleFirst?: boolean;
  gameMode?: 0 | 1 | 2;
  staffMessageId?: string;
  fixtureOrdinal?: number;
  automaticFill?: boolean;
}): Promise<{ groupId: number; requestIds: number[] }> {
  const timestamp = Date.now();
  const fixtureOrdinal = input.fixtureOrdinal ?? 1;
  const groupId = input.seed.groupCount + fixtureOrdinal;
  const requestIds = Array.from(
    { length: input.memberCount },
    (_, index) => input.seed.scale + (fixtureOrdinal - 1) * 4 + index + 1,
  );
  const isPriority = input.isPriority === true ? 1 : 0;
  const gameMode = input.gameMode ?? 2;
  const sortKey = input.visibleFirst
    ? fixtureOrdinal * SORT_STEP
    : (isPriority === 1 ? input.seed.priorityMaxSortKey : input.seed.ordinaryMaxSortKey) +
      fixtureOrdinal * SORT_STEP;
  const requestRows = requestIds.map((id, index) => ({ id, position: index + 1 }));
  for (const row of requestRows) {
    await seedOperationMapping({
      suffix: `${input.suffix}_${row.position}`,
      discordUserId: `${OPERATION_PREFIX}discord-${input.suffix}-${row.position}`,
      twitchUserId: `${OPERATION_PREFIX}twitch-${input.suffix}-${row.position}`,
    });
  }
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO raid_groups
       (id, is_priority, game_mode, sort_key, map_id, requester_capacity,
        leader_discord_user_id, leader_type, automatic_fill, attempt_count, state,
        discord_call_status, twitch_call_status, staff_message_id, started_at,
        created_at, updated_at)
       VALUES (?, ?, ?, ?, 'customs', 3, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      groupId,
      isPriority,
      gameMode,
      sortKey,
      input.state === "active" ? input.streamerDiscordUserId : null,
      input.state === "active" ? 0 : null,
      input.automaticFill === true ? 1 : 0,
      input.state === "active" ? 1 : 0,
      input.state === "active" ? 1 : 0,
      input.state === "active" ? 1 : 3,
      input.state === "active" ? 1 : 3,
      input.state === "active"
        ? `${OPERATION_PREFIX}detail-${input.suffix}`
        : (input.staffMessageId ?? null),
      input.state === "active" ? timestamp : null,
      timestamp,
      timestamp,
    ),
    env.DB.prepare(
      `INSERT INTO help_requests
       (id, source_platform, source_delivery_id, discord_user_id, twitch_user_id,
        twitch_login, in_game_name, game_mode, map_id, objective, is_priority, state,
        created_at, updated_at)
       SELECT json_extract(value, '$.id'), 0,
              printf('bench-op-seed-${input.suffix}-%d', json_extract(value, '$.position')),
              printf('${OPERATION_PREFIX}discord-${input.suffix}-%d', json_extract(value, '$.position')),
              printf('${OPERATION_PREFIX}twitch-${input.suffix}-%d', json_extract(value, '$.position')),
              printf('op_${input.suffix}_%d', json_extract(value, '$.position')),
              printf('Benchmark PMC %d', json_extract(value, '$.position')),
              ?, 'customs', printf('Benchmark goal %d', json_extract(value, '$.position')),
              ?, 1, ?, ? FROM json_each(?)`,
    ).bind(gameMode, isPriority, timestamp, timestamp, jsonRows(requestRows)),
    env.DB.prepare(
      `INSERT INTO raid_group_members
       (group_id, request_id, position, created_at, updated_at)
       SELECT ?, json_extract(value, '$.id'), json_extract(value, '$.position'), ?, ?
       FROM json_each(?)`,
    ).bind(groupId, timestamp, timestamp, jsonRows(requestRows)),
  ]);
  return { groupId, requestIds };
}

export function queueRequestId(scale: number, percentile: 10 | 50 | 90): number {
  return Math.max(1, Math.ceil((scale * percentile) / 100));
}

export function encodeHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function signedDiscordRequest(privateKey: CryptoKey, body: unknown): Promise<Request> {
  const timestamp = String(Math.floor(Date.now() / 1_000));
  const rawBody = JSON.stringify(body);
  const signature = encodeHex(
    await crypto.subtle.sign(
      "Ed25519",
      privateKey,
      new TextEncoder().encode(`${timestamp}${rawBody}`),
    ),
  );
  return new Request("https://benchmark.invalid/webhooks/discord/interactions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature-Ed25519": signature,
      "X-Signature-Timestamp": timestamp,
    },
    body: rawBody,
  });
}

export function discordContext(
  config: CommunityConfig,
  input: {
    id: string;
    type: 2 | 3 | 5;
    data: Record<string, unknown>;
    userId: string;
    staff?: boolean;
    messageId?: string;
  },
): Record<string, unknown> {
  return {
    id: input.id,
    application_id: config.discord.applicationId,
    guild_id: config.discord.guildId,
    channel_id: input.staff ? config.discord.staffChannelId : config.discord.requestChannelId,
    member: {
      user: { id: input.userId, username: "BenchmarkViewer" },
      roles: input.staff ? [config.discord.volunteerRoleId] : [],
    },
    ...(input.messageId === undefined ? {} : { message: { id: input.messageId } }),
    type: input.type,
    data: input.data,
  };
}

export function discordRequestModal(
  config: CommunityConfig,
  input: {
    id: string;
    userId: string;
    twitchLogin: string;
    gameMode?: "pvp-seasonal" | "pvp" | "pve";
  },
): Record<string, unknown> {
  const text = (customId: string, value: string) => ({
    type: 18,
    component: { type: 4, custom_id: customId, value },
  });
  return discordContext(config, {
    id: input.id,
    type: 5,
    userId: input.userId,
    data: {
      custom_id: `request:create:v2:${input.gameMode ?? "pve"}`,
      components: [
        text("request:twitch-name", input.twitchLogin),
        text("request:in-game-name", "Benchmark PMC"),
        { type: 18, component: { type: 3, custom_id: "request:map", values: ["customs"] } },
        text("request:objective", "Benchmark objective"),
        text("request:notes", "Benchmark notes"),
      ],
    },
  });
}

export async function signedTwitchRequest(input: {
  text: string;
  deliveryId: string;
  twitchUserId: string;
  twitchLogin: string;
  eventSubSecret: string;
  broadcasterUserId: string;
}): Promise<Request> {
  const timestamp = new Date().toISOString();
  const body = JSON.stringify({
    subscription: { type: "channel.chat.message" },
    event: {
      broadcaster_user_id: input.broadcasterUserId,
      broadcaster_user_login: "butcoffee",
      chatter_user_id: input.twitchUserId,
      chatter_user_login: input.twitchLogin,
      message_id: `${input.deliveryId}-message`,
      message: { text: input.text },
    },
  });
  const signature = await createTwitchEventSubSignature(
    input.eventSubSecret,
    input.deliveryId,
    timestamp,
    body,
  );
  return new Request("https://benchmark.invalid/webhooks/twitch/eventsub", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Twitch-Eventsub-Message-Id": input.deliveryId,
      "Twitch-Eventsub-Message-Timestamp": timestamp,
      "Twitch-Eventsub-Message-Signature": signature,
      "Twitch-Eventsub-Message-Type": "notification",
      "Twitch-Eventsub-Subscription-Type": "channel.chat.message",
    },
    body,
  });
}

export async function runWorkerRequest(
  worker: ReturnType<typeof createWorker>,
  environment: CloudflareEnvironment,
  request: Request,
): Promise<{ response: Response; wallMs: number }> {
  const context = createExecutionContext();
  const startedAt = performance.now();
  const response = await worker.fetch(
    request as Parameters<typeof worker.fetch>[0],
    environment,
    context,
  );
  await waitOnExecutionContext(context);
  return { response, wallMs: Number((performance.now() - startedAt).toFixed(3)) };
}
