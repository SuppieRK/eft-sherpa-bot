import { env } from "cloudflare:workers";
import { expect, it, vi } from "vitest";
import { createWorker } from "../src";
import type { CommunityConfig } from "../src/config/community";
import { D1Metrics, instrumentD1Database } from "../src/infrastructure/cloudflare/d1-metrics";
import type { CloudflareEnvironment } from "../src/infrastructure/cloudflare/environment";
import { testCommunityConfig } from "../test/fixtures/community";
import {
  BENCHMARK_SAMPLES,
  BENCHMARK_SCALES,
  BENCHMARK_SCALES_BY_OPERATION,
  BENCHMARK_WARMUPS,
  type UserOperationId,
} from "./contract";
import { aggregateMeasurements, assertStableCost, type OperationMeasurement } from "./statistics";
import {
  discordContext,
  discordRequestModal,
  encodeHex,
  OPERATION_PREFIX,
  queueRequestId,
  prepareStatisticsSeed,
  prepareUserDirectorySeed,
  resetOperationFixture,
  runWorkerRequest,
  seedDatabase,
  seedExpiredReceiptBacklog,
  seedOperationMapping,
  seedOperationRaid,
  seedRemovedMembershipHistory,
  seedWaitingBacklog,
  type SeedState,
  signedDiscordRequest,
  signedTwitchRequest,
} from "./support";

interface ExternalCall {
  method: string;
  url: string;
  body: string;
}

interface PreparedOperation {
  request: Request;
  verify(response: Response): Promise<void> | void;
}

interface OperationDefinition {
  id: UserOperationId;
  label: string;
  prepare(seed: SeedState, sample: number): Promise<PreparedOperation>;
}

class DiscordMock implements Pick<Fetcher, "fetch"> {
  readonly calls: ExternalCall[] = [];
  #sequence = 0;

  reset(): void {
    this.calls.length = 0;
    this.#sequence = 0;
  }

  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== "discord.benchmark.invalid") {
      throw new Error(`Unexpected Discord network request: ${request.url}`);
    }
    const body =
      request.method === "POST" || request.method === "PATCH" ? await request.text() : "";
    this.calls.push({ method: request.method, url: request.url, body });
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    const pathMessageId = /\/messages\/([^/]+)$/.exec(url.pathname)?.[1];
    const id = pathMessageId ?? `${OPERATION_PREFIX}message-${++this.#sequence}`;
    return Response.json({ id });
  }
}

function ordinal(value: number): string {
  const remainder100 = value % 100;
  const suffix =
    remainder100 >= 11 && remainder100 <= 13
      ? "th"
      : value % 10 === 1
        ? "st"
        : value % 10 === 2
          ? "nd"
          : value % 10 === 3
            ? "rd"
            : "th";
  return `${value}${suffix}`;
}

async function responseText(response: Response): Promise<string> {
  return JSON.stringify(await response.json());
}

function operationDefinitions(input: {
  config: CommunityConfig;
  privateKey: CryptoKey;
  discordMock: DiscordMock;
  twitchCalls: ExternalCall[];
}): OperationDefinition[] {
  const { config, privateKey, discordMock, twitchCalls } = input;
  const streamerId = config.discord.streamerUserId;
  const command = async (details: {
    id: string;
    name: string;
    userId: string;
    staff?: boolean;
    options?: unknown[];
  }) =>
    signedDiscordRequest(
      privateKey,
      discordContext(config, {
        id: details.id,
        type: 2,
        userId: details.userId,
        ...(details.staff === undefined ? {} : { staff: details.staff }),
        data: {
          type: 1,
          name: details.name,
          ...(details.options === undefined ? {} : { options: details.options }),
        },
      }),
    );
  const component = async (details: {
    id: string;
    customId: string;
    values?: string[];
    messageId?: string;
  }) =>
    signedDiscordRequest(
      privateKey,
      discordContext(config, {
        id: details.id,
        type: 3,
        userId: streamerId,
        staff: true,
        ...(details.messageId === undefined ? {} : { messageId: details.messageId }),
        data: { custom_id: details.customId, values: details.values ?? [] },
      }),
    );
  const twitch = (details: {
    text: string;
    deliveryId: string;
    twitchUserId: string;
    twitchLogin: string;
  }) =>
    signedTwitchRequest({
      ...details,
      eventSubSecret: "benchmark-eventsub-secret-is-long-enough",
      broadcasterUserId: config.twitch.broadcasterUserId,
    });
  const seedPullFixture = async (seed: SeedState) => {
    const destination = await seedOperationRaid({
      seed,
      suffix: "pull_destination",
      fixtureOrdinal: 1,
      memberCount: 2,
      state: "planned",
      streamerDiscordUserId: streamerId,
      isPriority: true,
      staffMessageId: `${OPERATION_PREFIX}detail-pull`,
    });
    const source = await seedOperationRaid({
      seed,
      suffix: "pull_source",
      fixtureOrdinal: 2,
      memberCount: 3,
      state: "planned",
      streamerDiscordUserId: streamerId,
      automaticFill: true,
      visibleFirst: true,
    });
    const pushTarget = await seedOperationRaid({
      seed,
      suffix: "pull_target",
      fixtureOrdinal: 3,
      memberCount: 1,
      state: "planned",
      streamerDiscordUserId: streamerId,
      automaticFill: true,
      visibleFirst: true,
    });
    return { destination, source, pushTarget };
  };
  const queueDefinitions = (platform: "discord" | "twitch") =>
    ([10, 50, 90] as const).map<OperationDefinition>((percentile) => ({
      id: `${platform}.queue.p${percentile}`,
      label: `${platform === "discord" ? "Discord /queue" : "Twitch !queue"} at p${percentile}`,
      async prepare(seed, sample) {
        const requestId = queueRequestId(seed.scale, percentile);
        const queuePosition = await env.DB.prepare(
          `WITH target AS (
             SELECT id, game_mode, is_priority FROM help_requests WHERE id = ?
           )
           SELECT count(*) AS ordinal
           FROM help_requests AS request, target
           WHERE request.state IN (0, 1) AND request.game_mode = target.game_mode
             AND (request.is_priority > target.is_priority OR
                  (request.is_priority = target.is_priority AND request.id <= target.id))`,
        )
          .bind(requestId)
          .first<{ ordinal: number }>();
        const expectedOrdinal = Number(queuePosition?.ordinal ?? 0);
        const interactionId = `${OPERATION_PREFIX}${platform}-queue-p${percentile}-${sample}`;
        const request =
          platform === "discord"
            ? await command({
                id: interactionId,
                name: "queue",
                userId: `bench-discord-${requestId}`,
              })
            : await twitch({
                text: "!queue",
                deliveryId: interactionId,
                twitchUserId: `bench-twitch-${requestId}`,
                twitchLogin: `bench_${String(requestId).padStart(6, "0")}`,
              });
        return {
          request,
          async verify(response) {
            expect(response.status).toBe(platform === "discord" ? 200 : 204);
            const expectedQueueText =
              expectedOrdinal <= 101
                ? `${ordinal(expectedOrdinal)} in the`
                : "More than 100 requests ahead";
            if (platform === "discord") {
              expect(await responseText(response)).toContain(expectedQueueText);
            } else {
              expect(twitchCalls.at(-1)?.body).toContain(expectedQueueText);
            }
          },
        };
      },
    }));

  return [
    {
      id: "discord.request.form.prefilled",
      label: "Discord /request prefilled form",
      async prepare(_seed, sample) {
        const userId = `${OPERATION_PREFIX}discord-prefilled`;
        await seedOperationMapping({ suffix: "prefilled", discordUserId: userId });
        return {
          request: await command({
            id: `${OPERATION_PREFIX}discord-form-${sample}`,
            name: "request",
            userId,
            options: [{ name: "mode", type: 3, value: "pve" }],
          }),
          async verify(response) {
            expect(response.status).toBe(200);
            const body = await responseText(response);
            expect(body).toContain("op_prefilled");
            expect(body).toContain("Benchmark PMC");
          },
        };
      },
    },
    {
      id: "discord.request.submit.created",
      label: "Discord request submission (created)",
      async prepare(_seed, sample) {
        const userId = `${OPERATION_PREFIX}discord-created`;
        await seedOperationMapping({ suffix: "discord_created", discordUserId: userId });
        return {
          request: await signedDiscordRequest(
            privateKey,
            discordRequestModal(config, {
              id: `${OPERATION_PREFIX}discord-created-${sample}`,
              userId,
              twitchLogin: "op_discord_created",
            }),
          ),
          async verify(response) {
            expect(response.status).toBe(200);
            expect(await responseText(response)).toContain("is in the queue");
            const row = await env.DB.prepare(
              "SELECT state FROM help_requests WHERE twitch_login = 'op_discord_created'",
            ).first<{ state: number }>();
            expect(row?.state).toBe(1);
          },
        };
      },
    },
    {
      id: "discord.request.submit.already-active",
      label: "Discord request submission (already active)",
      async prepare(seed, sample) {
        await seedOperationRaid({
          seed,
          suffix: "discord_already",
          memberCount: 1,
          state: "planned",
          streamerDiscordUserId: streamerId,
        });
        return {
          request: await signedDiscordRequest(
            privateKey,
            discordRequestModal(config, {
              id: `${OPERATION_PREFIX}discord-already-${sample}`,
              userId: `${OPERATION_PREFIX}discord-discord_already-1`,
              twitchLogin: "op_discord_already_1",
            }),
          ),
          async verify(response) {
            expect(response.status).toBe(200);
            expect(await responseText(response)).toContain("already queued");
          },
        };
      },
    },
    ...queueDefinitions("discord"),
    {
      id: "discord.link.self",
      label: "Discord /link-twitch self-link",
      async prepare(_seed, sample) {
        const userId = `${OPERATION_PREFIX}discord-link-self`;
        return {
          request: await command({
            id: `${OPERATION_PREFIX}discord-link-${sample}`,
            name: "link-twitch",
            userId,
            options: [
              { name: "name", type: 3, value: "op_link_self" },
              { name: "eft", type: 3, value: "Linked PMC" },
            ],
          }),
          async verify(response) {
            expect(response.status).toBe(200);
            expect(await responseText(response)).toContain("op_link_self");
            const row = await env.DB.prepare(
              "SELECT discord_user_id AS discordUserId FROM user_mappings WHERE twitch_login = 'op_link_self'",
            ).first<{ discordUserId: string }>();
            expect(row?.discordUserId).toBe(userId);
          },
        };
      },
    },
    {
      id: "twitch.request.created",
      label: "Twitch !request (created)",
      async prepare(_seed, sample) {
        return {
          request: await twitch({
            text: "!request pve customs benchmark objective",
            deliveryId: `${OPERATION_PREFIX}twitch-created-${sample}`,
            twitchUserId: `${OPERATION_PREFIX}twitch-created`,
            twitchLogin: "op_twitch_created",
          }),
          async verify(response) {
            expect(response.status).toBe(204);
            expect(twitchCalls.at(-1)?.body).toContain("queued for PvE · Customs");
            const row = await env.DB.prepare(
              "SELECT state FROM help_requests WHERE twitch_login = 'op_twitch_created'",
            ).first<{ state: number }>();
            expect(row?.state).toBe(1);
          },
        };
      },
    },
    {
      id: "twitch.request.already-active",
      label: "Twitch !request (already active)",
      async prepare(seed, sample) {
        await seedOperationRaid({
          seed,
          suffix: "twitch_already",
          memberCount: 1,
          state: "planned",
          streamerDiscordUserId: streamerId,
        });
        return {
          request: await twitch({
            text: "!request pve customs another objective",
            deliveryId: `${OPERATION_PREFIX}twitch-already-${sample}`,
            twitchUserId: `${OPERATION_PREFIX}twitch-twitch_already-1`,
            twitchLogin: "op_twitch_already_1",
          }),
          verify(response) {
            expect(response.status).toBe(204);
            expect(twitchCalls.at(-1)?.body).toContain("already queued");
          },
        };
      },
    },
    {
      id: "twitch.request.invalid",
      label: "Twitch !request (invalid guidance)",
      async prepare(_seed, sample) {
        return {
          request: await twitch({
            text: "!request pve",
            deliveryId: `${OPERATION_PREFIX}twitch-invalid-${sample}`,
            twitchUserId: `${OPERATION_PREFIX}twitch-invalid`,
            twitchLogin: "op_twitch_invalid",
          }),
          async verify(response) {
            expect(response.status).toBe(204);
            expect(twitchCalls.at(-1)?.body).toContain("Use !request [mode] [map] [goal]");
            const row = await env.DB.prepare(
              "SELECT id FROM help_requests WHERE twitch_login = 'op_twitch_invalid'",
            ).first();
            expect(row).toBeNull();
          },
        };
      },
    },
    {
      id: "twitch.request.invalid.expired-receipts",
      label: "Twitch invalid request with expired-receipt backlog",
      async prepare(_seed, sample) {
        await seedExpiredReceiptBacklog(600);
        return {
          request: await twitch({
            text: "!request pve",
            deliveryId: `${OPERATION_PREFIX}twitch-expired-${sample}`,
            twitchUserId: `${OPERATION_PREFIX}twitch-expired`,
            twitchLogin: "op_twitch_expired",
          }),
          async verify(response) {
            expect(response.status).toBe(204);
            const remaining = await env.DB.prepare(
              `SELECT count(*) AS count FROM event_receipts
               WHERE delivery_id LIKE 'bench-op-expired-%'`,
            ).first<{ count: number }>();
            expect(remaining?.count).toBe(350);
          },
        };
      },
    },
    ...queueDefinitions("twitch"),
    {
      id: "discord.board.create",
      label: "Discord /board create",
      async prepare(_seed, sample) {
        await env.DB.prepare(
          "UPDATE community_state SET staff_board_message_id = NULL WHERE community_id = 'butcoffee'",
        ).run();
        return {
          request: await command({
            id: `${OPERATION_PREFIX}board-create-${sample}`,
            name: "board",
            userId: streamerId,
            staff: true,
          }),
          async verify(response) {
            expect(response.status).toBe(200);
            expect(await responseText(response)).toContain("Open the sherpa board");
            expect(discordMock.calls.some((call) => call.method === "POST")).toBe(true);
          },
        };
      },
    },
    {
      id: "discord.board.open",
      label: "Discord /board open existing",
      async prepare(_seed, sample) {
        return {
          request: await command({
            id: `${OPERATION_PREFIX}board-open-${sample}`,
            name: "board",
            userId: streamerId,
            staff: true,
          }),
          verify(response) {
            expect(response.status).toBe(200);
            expect(discordMock.calls.some((call) => call.method === "PATCH")).toBe(true);
          },
        };
      },
    },
    {
      id: "discord.board.refresh",
      label: "Discord board Refresh",
      async prepare(seed, sample) {
        await seedOperationRaid({
          seed,
          suffix: "refresh",
          memberCount: 2,
          state: "active",
          streamerDiscordUserId: streamerId,
          isPriority: true,
          visibleFirst: true,
        });
        return {
          request: await component({
            id: `${OPERATION_PREFIX}board-refresh-${sample}`,
            customId: "board:v6:refresh",
          }),
          verify(response) {
            expect(response.status).toBe(200);
            expect(discordMock.calls.some((call) => call.method === "GET")).toBe(false);
            expect(discordMock.calls.some((call) => call.method === "PATCH")).toBe(true);
          },
        };
      },
    },
    {
      id: "discord.board.refresh.waiting-backlog",
      label: "Discord board Refresh with waiting recovery backlog",
      async prepare(seed, sample) {
        await seedWaitingBacklog(seed, seed.scale);
        return {
          request: await component({
            id: `${OPERATION_PREFIX}board-waiting-${sample}`,
            customId: "board:v6:refresh",
          }),
          async verify(response) {
            expect(response.status).toBe(200);
            const counts = await env.DB.prepare(
              `SELECT sum(state = 0) AS waiting, sum(state = 1) AS planned
               FROM help_requests WHERE twitch_login LIKE 'op_waiting_%'`,
            ).first<{ waiting: number; planned: number }>();
            expect(counts).toEqual({ waiting: seed.scale - 250, planned: 250 });
          },
        };
      },
    },
    {
      id: "discord.board.refresh.removed-history",
      label: "Discord board Refresh with removed membership history",
      async prepare(seed, sample) {
        await seedRemovedMembershipHistory(seed, seed.scale);
        return {
          request: await component({
            id: `${OPERATION_PREFIX}board-history-${sample}`,
            customId: "board:v6:refresh",
          }),
          async verify(response) {
            expect(response.status).toBe(200);
            const remaining = await env.DB.prepare(
              `SELECT count(*) AS count FROM raid_group_members
               WHERE group_id = 1 AND state = 2`,
            ).first<{ count: number }>();
            expect(remaining?.count).toBe(seed.scale);
          },
        };
      },
    },
    {
      id: "discord.raid.review",
      label: "Discord planned raid review",
      async prepare(seed, sample) {
        const raid = await seedOperationRaid({
          seed,
          suffix: "review",
          memberCount: 3,
          state: "planned",
          streamerDiscordUserId: streamerId,
          isPriority: true,
          visibleFirst: true,
        });
        return {
          request: await component({
            id: `${OPERATION_PREFIX}raid-review-${sample}`,
            customId: "board:v6:review",
            values: [String(raid.groupId)],
          }),
          async verify(response) {
            expect(response.status).toBe(200);
            const row = await env.DB.prepare(
              `SELECT state, automatic_fill AS automaticFill, attempt_count AS attemptCount,
                      leader_discord_user_id AS leaderId,
                      discord_call_status AS discordCallStatus,
                      twitch_call_status AS twitchCallStatus, staff_message_id AS staffMessageId
               FROM raid_groups WHERE id = ?`,
            )
              .bind(raid.groupId)
              .first<Record<string, number | string | null>>();
            expect(row).toEqual({
              state: 0,
              automaticFill: 0,
              attemptCount: 0,
              leaderId: null,
              discordCallStatus: 3,
              twitchCallStatus: 3,
              staffMessageId: `${OPERATION_PREFIX}message-1`,
            });
            expect(twitchCalls.some((call) => call.url.includes("/chat/messages"))).toBe(false);
          },
        };
      },
    },
    {
      id: "discord.raid.review.cancel",
      label: "Discord planned raid review Cancel",
      async prepare(seed, sample) {
        const messageId = `${OPERATION_PREFIX}detail-cancel-review`;
        const raid = await seedOperationRaid({
          seed,
          suffix: "cancel_review",
          memberCount: 3,
          state: "planned",
          streamerDiscordUserId: streamerId,
          isPriority: true,
          visibleFirst: true,
          staffMessageId: messageId,
        });
        return {
          request: await component({
            id: `${OPERATION_PREFIX}raid-cancel-review-${sample}`,
            customId: `raid:v3:cancel:${raid.groupId}`,
            messageId,
          }),
          async verify(response) {
            expect(response.status).toBe(200);
            expect(await responseText(response)).toContain("Review closed");
            const row = await env.DB.prepare(
              `SELECT state, automatic_fill AS automaticFill,
                      attempt_count AS attemptCount, staff_message_id AS staffMessageId
               FROM raid_groups WHERE id = ?`,
            )
              .bind(raid.groupId)
              .first<Record<string, number | string | null>>();
            expect(row).toEqual({
              state: 0,
              automaticFill: 0,
              attemptCount: 0,
              staffMessageId: null,
            });
            expect(
              discordMock.calls.some(
                (call) => call.method === "DELETE" && call.url.endsWith(`/${messageId}`),
              ),
            ).toBe(true);
            expect(twitchCalls.some((call) => call.url.includes("/chat/messages"))).toBe(false);
          },
        };
      },
    },
    {
      id: "discord.raid.call-start.streamer",
      label: "Discord streamer-led Call and start raid",
      async prepare(seed, sample) {
        const raid = await seedOperationRaid({
          seed,
          suffix: "call_start",
          memberCount: 3,
          state: "planned",
          streamerDiscordUserId: streamerId,
          isPriority: true,
          visibleFirst: true,
          staffMessageId: `${OPERATION_PREFIX}detail-call-start`,
        });
        return {
          request: await component({
            id: `${OPERATION_PREFIX}raid-call-start-${sample}`,
            customId: `raid:v2:call:${raid.groupId}`,
          }),
          async verify(response) {
            expect(response.status).toBe(200);
            const row = await env.DB.prepare(
              "SELECT state, leader_discord_user_id AS leaderId FROM raid_groups WHERE id = ?",
            )
              .bind(raid.groupId)
              .first<{ state: number; leaderId: string }>();
            expect(row).toEqual({ state: 1, leaderId: streamerId });
            expect(twitchCalls.some((call) => call.url.includes("/chat/messages"))).toBe(true);
          },
        };
      },
    },
    {
      id: "discord.requester.pull.candidates",
      label: "Discord direct pull requester selector",
      async prepare(seed, sample) {
        const fixture = await seedPullFixture(seed);
        return {
          request: await component({
            id: `${OPERATION_PREFIX}pull-candidates-${sample}`,
            customId: "board:v6:review",
            values: [String(fixture.destination.groupId)],
          }),
          verify(response) {
            expect(response.status).toBe(200);
            const detailUpdate = discordMock.calls.find(
              (call) =>
                call.method === "PATCH" && call.url.endsWith(`/${OPERATION_PREFIX}detail-pull`),
            );
            expect(detailUpdate?.body).toContain(
              `raid:v3:pull:${fixture.destination.groupId}:${fixture.source.groupId}`,
            );
            expect(detailUpdate?.body).toContain("@op_pull_source_1");
            expect(detailUpdate?.body).toContain("Benchmark goal 1");
          },
        };
      },
    },
    {
      id: "discord.requester.pull.with-push",
      label: "Discord pull requester with bounded push-down",
      async prepare(seed, sample) {
        const fixture = await seedPullFixture(seed);
        const selectedRequestId = fixture.source.requestIds[0] as number;
        return {
          request: await component({
            id: `${OPERATION_PREFIX}pull-with-push-${sample}`,
            customId: `raid:v3:pull:${fixture.destination.groupId}:${fixture.source.groupId}`,
            values: [String(selectedRequestId)],
          }),
          async verify(response) {
            expect(response.status).toBe(200);
            expect(await responseText(response)).toContain("remaining source requesters moved");
            const groups = await env.DB.prepare(
              `SELECT id, state, current_member_count AS memberCount
               FROM raid_groups WHERE id IN (?, ?, ?) ORDER BY id`,
            )
              .bind(fixture.destination.groupId, fixture.source.groupId, fixture.pushTarget.groupId)
              .all<{ id: number; state: number; memberCount: number }>();
            expect(groups.results).toEqual([
              { id: fixture.destination.groupId, state: 0, memberCount: 3 },
              { id: fixture.source.groupId, state: 3, memberCount: 0 },
              { id: fixture.pushTarget.groupId, state: 0, memberCount: 3 },
            ]);
            const selected = await env.DB.prepare(
              "SELECT is_priority AS isPriority FROM help_requests WHERE id = ?",
            )
              .bind(selectedRequestId)
              .first<{ isPriority: number }>();
            expect(selected?.isPriority).toBe(1);
            expect(twitchCalls.some((call) => call.url.includes("/chat/messages"))).toBe(false);
          },
        };
      },
    },
    {
      id: "discord.raid.result.helped",
      label: "Discord raid result Helped",
      async prepare(seed, sample) {
        const raid = await seedOperationRaid({
          seed,
          suffix: "helped",
          memberCount: 3,
          state: "active",
          streamerDiscordUserId: streamerId,
          isPriority: true,
          visibleFirst: true,
        });
        return {
          request: await component({
            id: `${OPERATION_PREFIX}raid-helped-${sample}`,
            customId: `raid:v2:result:${raid.groupId}`,
            values: ["helped"],
          }),
          async verify(response) {
            expect(response.status).toBe(200);
            const row = await env.DB.prepare("SELECT state, outcome FROM raid_groups WHERE id = ?")
              .bind(raid.groupId)
              .first<{ state: number; outcome: number }>();
            expect(row).toEqual({ state: 2, outcome: 0 });
          },
        };
      },
    },
    ...([false, true] as const).map<OperationDefinition>((last) => ({
      id: last ? "discord.requester.postpone.last" : "discord.requester.postpone.remaining",
      label: `Discord postpone requester (${last ? "last requester" : "source remains"})`,
      async prepare(seed, sample) {
        const raid = await seedOperationRaid({
          seed,
          suffix: `postpone_${last ? "last" : "remaining"}`,
          memberCount: last ? 1 : 2,
          state: "active",
          streamerDiscordUserId: streamerId,
          isPriority: true,
          visibleFirst: true,
        });
        const requestId = raid.requestIds[0] as number;
        return {
          request: await component({
            id: `${OPERATION_PREFIX}postpone-${last ? "last" : "remaining"}-${sample}`,
            customId: `raid:v2:postpone:${raid.groupId}`,
            values: [String(requestId)],
          }),
          async verify(response) {
            expect(response.status).toBe(200);
            const source = await env.DB.prepare("SELECT state FROM raid_groups WHERE id = ?")
              .bind(raid.groupId)
              .first<{ state: number }>();
            expect(source?.state).toBe(last ? 3 : 1);
            const membershipCount = await env.DB.prepare(
              "SELECT count(*) AS count FROM raid_group_members WHERE request_id = ? AND state = 0",
            )
              .bind(requestId)
              .first<{ count: number }>();
            expect(membershipCount?.count).toBe(1);
          },
        };
      },
    })),
    ...([false, true] as const).map<OperationDefinition>((last) => ({
      id: last ? "discord.requester.remove.last" : "discord.requester.remove.remaining",
      label: `Discord remove requester (${last ? "last requester" : "source remains"})`,
      async prepare(seed, sample) {
        const raid = await seedOperationRaid({
          seed,
          suffix: `remove_${last ? "last" : "remaining"}`,
          memberCount: last ? 1 : 2,
          state: "active",
          streamerDiscordUserId: streamerId,
          isPriority: true,
          visibleFirst: true,
        });
        const requestId = raid.requestIds[0] as number;
        return {
          request: await component({
            id: `${OPERATION_PREFIX}remove-${last ? "last" : "remaining"}-${sample}`,
            customId: `raid:v2:remove:${raid.groupId}`,
            values: [String(requestId)],
          }),
          async verify(response) {
            expect(response.status).toBe(200);
            const request = await env.DB.prepare("SELECT state FROM help_requests WHERE id = ?")
              .bind(requestId)
              .first<{ state: number }>();
            expect(request?.state).toBe(3);
            const source = await env.DB.prepare("SELECT state FROM raid_groups WHERE id = ?")
              .bind(raid.groupId)
              .first<{ state: number }>();
            expect(source?.state).toBe(last ? 3 : 1);
          },
        };
      },
    })),
    {
      id: "discord.stats.all-time",
      label: "Discord /stats all-time snapshot",
      async prepare(seed, sample) {
        await prepareStatisticsSeed(seed);
        return {
          request: await command({
            id: `${OPERATION_PREFIX}stats-${sample}`,
            name: "stats",
            userId: streamerId,
            staff: true,
          }),
          async verify(response) {
            expect(response.status).toBe(200);
            const body = await responseText(response);
            expect(body).toContain("All-time sherpa statistics");
            expect(body).toContain("bench-leader");
            expect(body).toContain("more leaders");
          },
        };
      },
    },
    ...(["first", "middle", "last"] as const).map<OperationDefinition>((position) => ({
      id: `discord.users.${position}`,
      label: `Discord /users ${position} keyset page`,
      async prepare(seed, sample) {
        await prepareUserDirectorySeed();
        const cursor =
          position === "middle"
            ? `bench_${String(Math.max(1, Math.floor(seed.scale / 2) - 5)).padStart(6, "0")}`
            : position === "last"
              ? `bench_${String(Math.max(1, seed.scale - 10)).padStart(6, "0")}`
              : undefined;
        return {
          request:
            position === "first"
              ? await command({
                  id: `${OPERATION_PREFIX}users-first-${sample}`,
                  name: "users",
                  userId: streamerId,
                  staff: true,
                })
              : await component({
                  id: `${OPERATION_PREFIX}users-${position}-${sample}`,
                  customId: `users:v1:next:${cursor as string}`,
                }),
          async verify(response) {
            expect(response.status).toBe(200);
            const body = await responseText(response);
            expect(body).toContain("Sherpa users");
            expect(body).toContain("allowed_mentions");
          },
        };
      },
    })),
    {
      id: "discord.users.complete-discord",
      label: "Discord /users complete missing Discord member",
      async prepare(_seed, sample) {
        await prepareUserDirectorySeed();
        await env.DB.prepare(
          "UPDATE user_mappings SET discord_user_id = NULL WHERE twitch_login = 'bench_000001'",
        ).run();
        return {
          request: await signedDiscordRequest(
            privateKey,
            discordContext(config, {
              id: `${OPERATION_PREFIX}users-complete-${sample}`,
              type: 3,
              userId: streamerId,
              staff: true,
              data: {
                custom_id: "users:v1:add_discord:bench_000001:bench_000001",
                values: [`${OPERATION_PREFIX}completed-discord`],
                resolved: {
                  users: {
                    [`${OPERATION_PREFIX}completed-discord`]: {
                      id: `${OPERATION_PREFIX}completed-discord`,
                      username: "Completed viewer",
                    },
                  },
                  members: { [`${OPERATION_PREFIX}completed-discord`]: { roles: [] } },
                },
              },
            }),
          ),
          async verify(response) {
            expect(response.status).toBe(200);
            expect(await responseText(response)).toContain("bench_000001");
            const row = await env.DB.prepare(
              "SELECT discord_user_id AS discordUserId FROM user_mappings WHERE twitch_login = 'bench_000001'",
            ).first<{ discordUserId: string }>();
            expect(row?.discordUserId).toBe(`${OPERATION_PREFIX}completed-discord`);
          },
        };
      },
    },
  ];
}

async function seedCounts(seed: SeedState) {
  const result = await env.DB.batch<Record<string, number>>([
    env.DB.prepare("SELECT count(*) AS count FROM user_mappings"),
    env.DB.prepare("SELECT count(*) AS count FROM help_requests WHERE state IN (0, 1)"),
    env.DB.prepare("SELECT count(*) AS count FROM raid_groups WHERE state IN (0, 1)"),
    env.DB.prepare("SELECT count(*) AS count FROM raid_group_members WHERE state = 0"),
    env.DB.prepare("SELECT count(*) AS count FROM event_receipts"),
  ]);
  const count = (index: number) => Number(result[index]?.results[0]?.count ?? 0);
  expect(count(0)).toBe(seed.scale);
  expect(count(1)).toBe(seed.scale);
  expect(count(3)).toBe(seed.scale);
  expect(count(4)).toBe(seed.scale);
  return {
    scale: seed.scale,
    userMappings: count(0),
    activeRequests: count(1),
    openRaids: count(2),
    openMemberships: count(3),
    receipts: count(4),
    databaseBytes: seed.databaseBytes,
  };
}

it("benchmarks every selected user-facing operation with fully local D1", async () => {
  const emitResult = console.log.bind(console);
  const diagnostics = [
    vi.spyOn(console, "log").mockImplementation(() => undefined),
    vi.spyOn(console, "info").mockImplementation(() => undefined),
    vi.spyOn(console, "warn").mockImplementation(() => undefined),
    vi.spyOn(console, "error").mockImplementation(() => undefined),
  ];
  const twitchCalls: ExternalCall[] = [];
  const twitchFetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init);
    const url = new URL(request.url);
    if (url.hostname !== "twitch.benchmark.invalid") {
      throw new Error(`Unexpected network request: ${request.url}`);
    }
    twitchCalls.push({ method: request.method, url: request.url, body: await request.text() });
    return Response.json({
      data: [{ message_id: `${OPERATION_PREFIX}twitch-message`, is_sent: true }],
    });
  });
  try {
    const keyPair = (await crypto.subtle.generateKey("Ed25519", true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const config: CommunityConfig = {
      ...testCommunityConfig,
      discord: {
        ...testCommunityConfig.discord,
        publicKey: encodeHex(
          (await crypto.subtle.exportKey("raw", keyPair.publicKey)) as ArrayBuffer,
        ),
      },
    };
    const worker = createWorker(config);
    const discordMock = new DiscordMock();
    const definitions = operationDefinitions({
      config,
      privateKey: keyPair.privateKey,
      discordMock,
      twitchCalls,
    });
    const results: Array<{
      id: UserOperationId;
      label: string;
      scale: number;
      samples: OperationMeasurement[];
      aggregate: ReturnType<typeof aggregateMeasurements>;
    }> = [];
    const benchmarkScale = Number(
      (env as typeof env & { BENCHMARK_SCALE: number }).BENCHMARK_SCALE,
    );
    expect(BENCHMARK_SCALES).toContain(benchmarkScale);
    const seeds: Awaited<ReturnType<typeof seedCounts>>[] = [];
    for (const scale of [benchmarkScale]) {
      const seed = await seedDatabase(scale);
      seeds.push(await seedCounts(seed));
      for (const definition of definitions) {
        const selectedScales = BENCHMARK_SCALES_BY_OPERATION[definition.id];
        if (selectedScales !== undefined && !selectedScales.includes(scale)) continue;
        const measurements: OperationMeasurement[] = [];
        for (let sample = 0; sample < BENCHMARK_WARMUPS + BENCHMARK_SAMPLES; sample += 1) {
          await resetOperationFixture(seed);
          discordMock.reset();
          twitchCalls.length = 0;
          const prepared = await definition.prepare(seed, sample);
          const metrics = new D1Metrics();
          const environment = {
            ...(env as CloudflareEnvironment),
            DB: instrumentD1Database(env.DB, metrics),
            DISCORD_API_FETCHER: discordMock,
            DISCORD_API_BASE_URL: "https://discord.benchmark.invalid/api/v10",
            TWITCH_API_BASE_URL: "https://twitch.benchmark.invalid/helix",
            TWITCH_AUTH_BASE_URL: "https://twitch.benchmark.invalid/oauth2",
          } satisfies CloudflareEnvironment;
          const execution = await runWorkerRequest(worker, environment, prepared.request);
          await prepared.verify(execution.response);
          if (sample >= BENCHMARK_WARMUPS) {
            const usage = metrics.snapshot();
            measurements.push({
              wallMs: execution.wallMs,
              d1DurationMs: Number(usage.durationMs.toFixed(3)),
              statements: usage.statements,
              rowsRead: usage.rowsRead,
              rowsWritten: usage.rowsWritten,
            });
          }
        }
        assertStableCost(measurements);
        results.push({
          id: definition.id,
          label: definition.label,
          scale,
          samples: measurements,
          aggregate: aggregateMeasurements(measurements),
        });
      }
    }
    emitResult(
      `USER_FACING_BENCHMARK_RESULT=${JSON.stringify({
        schemaVersion: 1,
        localOnly: true,
        scales: [benchmarkScale],
        warmups: BENCHMARK_WARMUPS,
        samplesPerOperation: BENCHMARK_SAMPLES,
        queuePercentiles: [10, 50, 90],
        seeds,
        results,
      })}`,
    );
  } finally {
    twitchFetch.mockRestore();
    for (const diagnostic of diagnostics) diagnostic.mockRestore();
  }
});
