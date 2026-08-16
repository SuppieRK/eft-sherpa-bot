import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { type CommunityConfig, validateCommunityConfig } from "../../src/config/community";
import { createWorker } from "../../src";
import type { StaffBoardRaid } from "../../src/domain/staff-board";
import { D1MvpRepository } from "../../src/infrastructure/cloudflare/d1-mvp-repository";
import type { CloudflareEnvironment } from "../../src/infrastructure/cloudflare/environment";
import { testCommunityConfig } from "../fixtures/community";

const callbackUrl = "https://example.com/webhooks/discord/interactions";
const timestamp = String(Math.floor(Date.now() / 1_000));
const changedAt = new Date(Number(timestamp) * 1_000);
let privateKey: CryptoKey;
let config: CommunityConfig;
let worker: ReturnType<typeof createWorker>;
let messageSequence = 0;
let deleteResponseStatus = 204;
let createResponseStatus = 200;
let messageReadStatuses = new Map<string, number>();
let createBarrierTarget = 0;
let createBarrierResolvers: Array<() => void> = [];
let outbound: Array<{ method: string; url: string; body: Record<string, unknown> }> = [];

const discordFetcher = {
  async fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const request = input instanceof Request ? input : new Request(input, init);
    const body =
      request.method === "POST" || request.method === "PATCH"
        ? ((await request.json()) as Record<string, unknown>)
        : {};
    outbound.push({ method: request.method, url: request.url, body });
    if (request.method === "DELETE") {
      return new Response(null, { status: deleteResponseStatus });
    }
    const existingId = /\/messages\/([^/]+)$/.exec(new URL(request.url).pathname)?.[1];
    if (request.method === "GET" && existingId !== undefined) {
      const status = messageReadStatuses.get(existingId) ?? 200;
      return status === 200 ? Response.json({ id: existingId }) : new Response(null, { status });
    }
    if (request.method === "POST" && createResponseStatus !== 200) {
      return new Response(null, { status: createResponseStatus });
    }
    if (request.method === "POST" && createBarrierTarget > 0) {
      await new Promise<void>((resolve) => {
        createBarrierResolvers.push(resolve);
        if (createBarrierResolvers.length === createBarrierTarget) {
          const resolvers = createBarrierResolvers;
          createBarrierTarget = 0;
          createBarrierResolvers = [];
          for (const release of resolvers) release();
        }
      });
    }
    const id = existingId ?? `message-${++messageSequence}`;
    return Response.json({ id });
  },
} as Pick<Fetcher, "fetch">;

const testEnvironment = {
  ...(env as CloudflareEnvironment),
  DISCORD_API_BASE_URL: "https://discord.test/api/v10",
  DISCORD_API_FETCHER: discordFetcher,
} satisfies CloudflareEnvironment;

function encodeHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function signedRequest(body: unknown, signedTimestamp = timestamp): Promise<Request> {
  const rawBody = JSON.stringify(body);
  const signature = encodeHex(
    await crypto.subtle.sign(
      "Ed25519",
      privateKey,
      new TextEncoder().encode(`${signedTimestamp}${rawBody}`),
    ),
  );
  return new Request(callbackUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Signature-Ed25519": signature,
      "X-Signature-Timestamp": signedTimestamp,
    },
    body: rawBody,
  });
}

function context(overrides: Record<string, unknown> = {}) {
  return {
    id: "discord-interaction",
    application_id: config.discord.applicationId,
    guild_id: config.discord.guildId,
    channel_id: config.discord.requestChannelId,
    member: { user: { id: "requester", username: "DiscordViewer" }, roles: [] },
    ...overrides,
  };
}

function requestModal(interactionId: string) {
  const text = (customId: string, value: string) => ({
    type: 18,
    component: { type: 4, custom_id: customId, value },
  });
  return context({
    id: interactionId,
    type: 5,
    data: {
      custom_id: "request:create:v1",
      components: [
        text("request:twitch-name", "TwitchViewer"),
        text("request:in-game-name", "Helpful PMC"),
        { type: 18, component: { type: 3, custom_id: "request:map", values: ["customs"] } },
        text("request:objective", "Complete a task"),
        text("request:notes", "Bring markers"),
      ],
    },
  });
}

async function seedActiveRaid(input: {
  interactionId: string;
  staffMessageId?: string;
  attemptTwo?: boolean;
}): Promise<{ repo: D1MvpRepository; raid: StaffBoardRaid }> {
  await worker.fetch(
    await signedRequest(requestModal(input.interactionId)),
    testEnvironment,
    createExecutionContext(),
  );
  const repo = new D1MvpRepository(env.DB);
  await repo.materializeWaitingRequests({
    changedAt,
    recipientLimit: config.policies.recipientLimit,
  });
  const planned = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids[0] as StaffBoardRaid;
  let raid = await repo.startRaid({
    groupId: planned.id,
    leaderDiscordUserId: "volunteer",
    leaderType: "volunteer",
    requestTwitchCall: false,
    changedAt,
  });
  if (input.attemptTwo === true) {
    raid = await repo.recordRaidResult({
      groupId: raid.id,
      outcome: "unsuccessful",
      attemptLimit: config.policies.attemptLimit,
      actionKey: `${input.interactionId}-attempt-two`,
      changedAt,
    });
  }
  if (input.staffMessageId !== undefined) {
    await repo.setRaidStaffMessage(raid.id, input.staffMessageId, changedAt);
    raid = (await repo.getRaid(raid.id)) as StaffBoardRaid;
  }
  await repo.setCanonicalBoardMessage({ messageId: "canonical-board", changedAt });
  return { repo, raid };
}

async function refreshBoard(interactionId: string): Promise<Response> {
  const executionContext = createExecutionContext();
  const response = await worker.fetch(
    await signedRequest(
      context({
        channel_id: config.discord.staffChannelId,
        member: {
          user: { id: "volunteer", username: "Volunteer" },
          roles: [config.discord.volunteerRoleId],
        },
        id: interactionId,
        type: 3,
        data: { custom_id: "board:v5:refresh", values: [] },
      }),
    ),
    testEnvironment,
    executionContext,
  );
  await waitOnExecutionContext(executionContext);
  return response;
}

async function submitRaidResult(input: {
  interactionId: string;
  raidId: number;
  result: "helped" | "unsuccessful" | "postpone_raid";
}): Promise<Response> {
  const executionContext = createExecutionContext();
  const response = await worker.fetch(
    await signedRequest(
      context({
        channel_id: config.discord.staffChannelId,
        member: {
          user: { id: "volunteer", username: "Volunteer" },
          roles: [config.discord.volunteerRoleId],
        },
        id: input.interactionId,
        type: 3,
        data: { custom_id: `raid:v1:result:${input.raidId}`, values: [input.result] },
      }),
    ),
    testEnvironment,
    executionContext,
  );
  await waitOnExecutionContext(executionContext);
  return response;
}

beforeAll(async () => {
  const keyPair = (await crypto.subtle.generateKey("Ed25519", true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  privateKey = keyPair.privateKey;
  config = {
    ...testCommunityConfig,
    discord: {
      ...testCommunityConfig.discord,
      publicKey: encodeHex(
        (await crypto.subtle.exportKey("raw", keyPair.publicKey)) as ArrayBuffer,
      ),
    },
  };
  expect(validateCommunityConfig(config)).toEqual([]);
  worker = createWorker(config);
});

beforeEach(async () => {
  outbound = [];
  messageSequence = 0;
  deleteResponseStatus = 204;
  createResponseStatus = 200;
  messageReadStatuses = new Map();
  createBarrierTarget = 0;
  createBarrierResolvers = [];
});

describe("Discord progressive raid workflow", () => {
  it("rejects a correctly signed interaction after the replay window", async () => {
    const staleTimestamp = String(Math.floor(Date.now() / 1_000) - 11 * 60);
    const response = await worker.fetch(
      await signedRequest(context({ type: 2, data: { type: 1, name: "queue" } }), staleTimestamp),
      testEnvironment,
      createExecutionContext(),
    );
    expect(response.status).toBe(401);
  });

  it("creates a bounded request and directs the viewer to queue", async () => {
    const command = await signedRequest(context({ type: 2, data: { type: 1, name: "request" } }));
    const modal = await worker.fetch(command, testEnvironment, createExecutionContext());
    expect(await modal.json()).toMatchObject({
      type: 9,
      data: {
        components: expect.arrayContaining([
          expect.objectContaining({ description: "Maximum 150 characters." }),
          expect.objectContaining({ description: "Optional. Maximum 250 characters." }),
        ]),
      },
    });
    const response = await worker.fetch(
      await signedRequest(requestModal("create-request")),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await response.json()).toMatchObject({
      data: { content: "Your help request for Customs is in the queue. Use `/queue` to check it." },
    });
  });

  it("shows caller status without queue totals and does not expose position command", async () => {
    await worker.fetch(
      await signedRequest(requestModal("create-request")),
      testEnvironment,
      createExecutionContext(),
    );
    const queue = await worker.fetch(
      await signedRequest(context({ id: "queue", type: 2, data: { type: 1, name: "queue" } })),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await queue.json()).toMatchObject({
      data: {
        content: "1st overall for Customs, no raids ahead.",
      },
    });
    const position = await worker.fetch(
      await signedRequest(
        context({ id: "position", type: 2, data: { type: 1, name: "position" } }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(position.status).toBe(400);
  });

  it("formats the board command in unauthorized guidance", async () => {
    const response = await worker.fetch(
      await signedRequest(
        context({ id: "board-denied", type: 2, data: { type: 1, name: "board" } }),
      ),
      testEnvironment,
      createExecutionContext(),
    );

    expect(await response.json()).toMatchObject({
      data: {
        content: "Use `/board` in the staff channel as the streamer or a volunteer sherpa.",
      },
    });
  });

  it("creates one canonical board, starts a volunteer-led raid, and advances its attempt", async () => {
    await worker.fetch(
      await signedRequest(requestModal("create-request")),
      testEnvironment,
      createExecutionContext(),
    );
    const staff = {
      channel_id: config.discord.staffChannelId,
      member: {
        user: { id: "volunteer", username: "Volunteer" },
        roles: [config.discord.volunteerRoleId],
      },
    };
    const board = await worker.fetch(
      await signedRequest(
        context({ ...staff, id: "board", type: 2, data: { type: 1, name: "board" } }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await board.json()).toMatchObject({
      data: { content: expect.stringContaining("/message-1") },
    });
    const repo = new D1MvpRepository(env.DB);
    const raidId = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids[0]?.id;
    expect(raidId).toBeDefined();
    const start = await worker.fetch(
      await signedRequest(
        context({
          ...staff,
          id: "start",
          type: 3,
          data: { custom_id: "board:v5:start", values: [String(raidId)] },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(start.status).toBe(200);
    expect(await start.json()).toMatchObject({ type: 7 });
    expect(outbound.filter((request) => request.method === "POST")).toHaveLength(3);
    const requestCall = outbound.find(
      (request) =>
        request.method === "POST" &&
        request.url.includes(`/channels/${config.discord.requestChannelId}/messages`),
    );
    expect(requestCall?.body).toMatchObject({
      allowed_mentions: { parse: [], users: ["volunteer", "requester"] },
    });
    let raid = await repo.getRaid(raidId ?? 0);
    expect(raid).toMatchObject({
      state: "active",
      attemptCount: 1,
      leaderDiscordUserId: "volunteer",
      discordCallStatus: "sent",
      twitchCallStatus: "not_requested",
      staffMessageId: "message-3",
    });
    const result = await worker.fetch(
      await signedRequest(
        context({
          ...staff,
          id: "attempt-two",
          type: 3,
          data: { custom_id: `raid:v1:result:${raidId}`, values: ["unsuccessful"] },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await result.json()).toMatchObject({
      type: 7,
      data: {
        content: "<@volunteer> this raid is ready.",
        allowed_mentions: { parse: [] },
        embeds: [expect.objectContaining({ description: expect.stringContaining("Attempt 2/3") })],
      },
    });
    raid = await repo.getRaid(raidId ?? 0);
    expect(raid?.attemptCount).toBe(2);
    expect(
      outbound.filter((request) => request.url.includes(config.discord.requestChannelId)),
    ).toHaveLength(1);
  });

  it("deletes the obsolete details message after recording Helped", async () => {
    const { repo, raid } = await seedActiveRaid({
      interactionId: "helped-result",
      staffMessageId: "helped-detail",
    });

    const response = await submitRaidResult({
      interactionId: "record-helped",
      raidId: raid.id,
      result: "helped",
    });

    expect(await response.json()).toMatchObject({
      type: 4,
      data: { content: "Raid recorded as Helped." },
    });
    expect(outbound).toContainEqual(
      expect.objectContaining({
        method: "DELETE",
        url: expect.stringContaining("/messages/helped-detail"),
      }),
    );
    const completed = await repo.getRaid(raid.id);
    expect(completed).toMatchObject({
      state: "completed",
      outcome: "helped",
    });
    expect(completed?.staffMessageId).toBeUndefined();
    expect((await repo.getBoardSnapshot(changedAt)).ordinaryRaids).toEqual([]);
  });

  it("keeps Helped durable and warns when Discord cannot delete the old message", async () => {
    const { repo, raid } = await seedActiveRaid({
      interactionId: "helped-delete-failure",
      staffMessageId: "undeletable-helped-detail",
    });
    deleteResponseStatus = 500;

    const response = await submitRaidResult({
      interactionId: "record-helped-delete-failure",
      raidId: raid.id,
      result: "helped",
    });

    expect(await response.json()).toMatchObject({
      type: 4,
      data: {
        content: "Raid recorded as Helped, but its old details message could not be deleted.",
      },
    });
    const completed = await repo.getRaid(raid.id);
    expect(completed).toMatchObject({
      state: "completed",
      outcome: "helped",
    });
    expect(completed?.staffMessageId).toBeUndefined();
  });

  it("uses Postpone raid after the final attempt without creating a replacement raid", async () => {
    const { repo, raid } = await seedActiveRaid({
      interactionId: "final-postpone-result",
      staffMessageId: "final-postpone-detail",
      attemptTwo: true,
    });
    await repo.recordRaidResult({
      groupId: raid.id,
      outcome: "unsuccessful",
      attemptLimit: config.policies.attemptLimit,
      actionKey: "final-postpone-attempt-three",
      changedAt,
    });

    const response = await submitRaidResult({
      interactionId: "record-final-postpone",
      raidId: raid.id,
      result: "postpone_raid",
    });

    expect(await response.json()).toMatchObject({
      type: 4,
      data: { content: "Raid postponed to the end of the Priority queue." },
    });
    expect(outbound).toContainEqual(
      expect.objectContaining({
        method: "DELETE",
        url: expect.stringContaining("/messages/final-postpone-detail"),
      }),
    );
    const postponed = await repo.getRaid(raid.id);
    expect(postponed).toMatchObject({
      id: raid.id,
      queueKind: "priority",
      state: "planned",
      attemptCount: 0,
    });
    expect(postponed?.staffMessageId).toBeUndefined();
    const groupCount = await env.DB.prepare(`SELECT count(*) AS count FROM raid_groups`).first<{
      count: number;
    }>();
    expect(groupCount?.count).toBe(1);
  });

  it("recreates a deleted active raid message without changing attempt state or pinging users", async () => {
    const { repo, raid } = await seedActiveRaid({
      interactionId: "repair-deleted",
      staffMessageId: "deleted-detail",
      attemptTwo: true,
    });
    messageReadStatuses.set("deleted-detail", 404);

    const response = await refreshBoard("refresh-deleted");
    expect(await response.json()).toMatchObject({ type: 7 });

    const repaired = await repo.getRaid(raid.id);
    expect(repaired).toMatchObject({
      id: raid.id,
      state: "active",
      queueKind: "ordinary",
      attemptCount: 2,
      leaderDiscordUserId: "volunteer",
      discordCallStatus: raid.discordCallStatus,
      twitchCallStatus: raid.twitchCallStatus,
      staffMessageId: "message-1",
    });
    expect(repaired?.members).toEqual(raid.members);
    const replacement = outbound.find((request) => request.method === "POST");
    expect(replacement?.body).toMatchObject({
      content: "<@volunteer> this raid is ready.",
      allowed_mentions: { parse: [] },
    });
    const canonicalUpdate = outbound.find(
      (request) => request.method === "PATCH" && request.url.endsWith("/canonical-board"),
    );
    expect(JSON.stringify(canonicalUpdate?.body)).toContain("/message-1");
    expect(JSON.stringify(canonicalUpdate?.body)).not.toContain("/deleted-detail");
  });

  it("retains an active message identity on a temporary Discord read failure", async () => {
    const { repo, raid } = await seedActiveRaid({
      interactionId: "retain-temporary",
      staffMessageId: "temporary-detail",
    });
    messageReadStatuses.set("temporary-detail", 500);

    await refreshBoard("refresh-temporary");

    expect((await repo.getRaid(raid.id))?.staffMessageId).toBe("temporary-detail");
    expect(outbound.filter((request) => request.method === "POST")).toHaveLength(0);
    const canonicalUpdate = outbound.find((request) => request.method === "PATCH");
    expect(JSON.stringify(canonicalUpdate?.body)).toContain("/temporary-detail");
  });

  it("clears a confirmed dead link when replacement creation fails", async () => {
    const { repo, raid } = await seedActiveRaid({
      interactionId: "failed-replacement",
      staffMessageId: "dead-detail",
    });
    messageReadStatuses.set("dead-detail", 404);
    createResponseStatus = 500;

    await refreshBoard("refresh-failed-replacement");

    expect((await repo.getRaid(raid.id))?.staffMessageId).toBeUndefined();
    const canonicalUpdate = outbound.find((request) => request.method === "PATCH");
    expect(JSON.stringify(canonicalUpdate?.body)).not.toContain("/dead-detail");
  });

  it("keeps one replacement and deletes the duplicate when refreshes overlap", async () => {
    const { repo, raid } = await seedActiveRaid({ interactionId: "concurrent-repair" });
    createBarrierTarget = 2;

    await Promise.all([refreshBoard("refresh-one"), refreshBoard("refresh-two")]);

    const creates = outbound.filter((request) => request.method === "POST");
    const deletes = outbound.filter((request) => request.method === "DELETE");
    expect(creates).toHaveLength(2);
    expect(deletes).toHaveLength(1);
    const retainedMessageId = (await repo.getRaid(raid.id))?.staffMessageId;
    expect(retainedMessageId).toMatch(/^message-[12]$/);
    expect(deletes[0]?.url).not.toContain(`/${retainedMessageId}`);
  });

  it("deletes an empty raid message after postponing its last requester", async () => {
    await worker.fetch(
      await signedRequest(requestModal("postpone-last-request")),
      testEnvironment,
      createExecutionContext(),
    );
    const repo = new D1MvpRepository(env.DB);
    const raid = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids[0] as StaffBoardRaid;
    await repo.startRaid({
      groupId: raid.id,
      leaderDiscordUserId: "volunteer",
      leaderType: "volunteer",
      requestTwitchCall: false,
      changedAt,
    });
    await repo.setRaidStaffMessage(raid.id, "postpone-last-message", changedAt);
    const response = await worker.fetch(
      await signedRequest(
        context({
          channel_id: config.discord.staffChannelId,
          member: {
            user: { id: "volunteer", username: "Volunteer" },
            roles: [config.discord.volunteerRoleId],
          },
          id: "postpone-last",
          type: 3,
          data: {
            custom_id: `raid:v1:postpone:${raid.id}`,
            values: [String(raid.members[0]?.requestId)],
          },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );

    expect(await response.json()).toMatchObject({
      type: 4,
      data: { content: expect.stringContaining("empty raid was closed") },
    });
    expect(outbound).toContainEqual(
      expect.objectContaining({
        method: "DELETE",
        url: expect.stringContaining("/messages/postpone-last-message"),
      }),
    );
    expect(await repo.getRaid(raid.id)).toMatchObject({ state: "canceled", outcome: "not_run" });
    expect((await repo.getBoardSnapshot(changedAt)).ordinaryRaids[0]).toMatchObject({
      state: "planned",
      automaticFill: true,
    });
  });

  it("keeps a permanent removal when the empty raid message cannot be deleted", async () => {
    await worker.fetch(
      await signedRequest(requestModal("remove-last-request")),
      testEnvironment,
      createExecutionContext(),
    );
    const repo = new D1MvpRepository(env.DB);
    const raid = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids[0] as StaffBoardRaid;
    await repo.startRaid({
      groupId: raid.id,
      leaderDiscordUserId: "volunteer",
      leaderType: "volunteer",
      requestTwitchCall: false,
      changedAt,
    });
    await repo.setRaidStaffMessage(raid.id, "remove-last-message", changedAt);
    deleteResponseStatus = 500;
    const response = await worker.fetch(
      await signedRequest(
        context({
          channel_id: config.discord.staffChannelId,
          member: {
            user: { id: "volunteer", username: "Volunteer" },
            roles: [config.discord.volunteerRoleId],
          },
          id: "remove-last",
          type: 3,
          data: {
            custom_id: `raid:v1:remove:${raid.id}`,
            values: [String(raid.members[0]?.requestId)],
          },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );

    expect(await response.json()).toMatchObject({
      type: 4,
      data: { content: expect.stringContaining("old details message could not be deleted") },
    });
    expect(outbound).toContainEqual(
      expect.objectContaining({
        method: "DELETE",
        url: expect.stringContaining("/messages/remove-last-message"),
      }),
    );
    const request = await env.DB.prepare(
      `SELECT CASE state WHEN 3 THEN 'canceled' ELSE 'other' END AS state
       FROM help_requests WHERE id = ?`,
    )
      .bind(raid.members[0]?.requestId)
      .first<{ state: string }>();
    expect(request?.state).toBe("canceled");
    expect((await repo.getBoardSnapshot(changedAt)).ordinaryRaids).toEqual([]);
  });

  it("postpones a whole raid to the end of Priority and deletes its old message", async () => {
    await worker.fetch(
      await signedRequest(requestModal("postpone-whole-request")),
      testEnvironment,
      createExecutionContext(),
    );
    const repo = new D1MvpRepository(env.DB);
    const raid = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids[0] as StaffBoardRaid;
    await repo.startRaid({
      groupId: raid.id,
      leaderDiscordUserId: "volunteer",
      leaderType: "volunteer",
      requestTwitchCall: false,
      changedAt,
    });
    await repo.setRaidStaffMessage(raid.id, "postpone-whole-message", changedAt);
    const response = await worker.fetch(
      await signedRequest(
        context({
          channel_id: config.discord.staffChannelId,
          member: {
            user: { id: "volunteer", username: "Volunteer" },
            roles: [config.discord.volunteerRoleId],
          },
          id: "postpone-whole",
          type: 3,
          data: {
            custom_id: `raid:v1:result:${raid.id}`,
            values: ["postpone_raid"],
          },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );

    expect(await response.json()).toMatchObject({
      type: 4,
      data: { content: "Raid postponed to the end of the Priority queue." },
    });
    expect(outbound).toContainEqual(
      expect.objectContaining({
        method: "DELETE",
        url: expect.stringContaining("/messages/postpone-whole-message"),
      }),
    );
    expect(await repo.getRaid(raid.id)).toMatchObject({
      queueKind: "priority",
      state: "planned",
      attemptCount: 0,
      leaderDiscordUserId: "volunteer",
      automaticFill: false,
      discordCallStatus: "not_requested",
      twitchCallStatus: "not_requested",
    });
  });

  it("denies raid controls to a volunteer who is not the assigned leader", async () => {
    await worker.fetch(
      await signedRequest(requestModal("create-request")),
      testEnvironment,
      createExecutionContext(),
    );
    const repo = new D1MvpRepository(env.DB);
    const raidId = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids[0]?.id ?? 0;
    await repo.startRaid({
      groupId: raidId,
      leaderDiscordUserId: "assigned-leader",
      leaderType: "volunteer",
      requestTwitchCall: false,
      changedAt,
    });
    const response = await worker.fetch(
      await signedRequest(
        context({
          channel_id: config.discord.staffChannelId,
          member: {
            user: { id: "other-volunteer", username: "Other" },
            roles: [config.discord.volunteerRoleId],
          },
          id: "unauthorized-result",
          type: 3,
          data: { custom_id: `raid:v1:result:${raidId}`, values: ["helped"] },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await response.json()).toMatchObject({
      data: { content: expect.stringContaining("Only this raid's leader") },
    });
    expect((await repo.getRaid(raidId))?.state).toBe("active");
  });
});
