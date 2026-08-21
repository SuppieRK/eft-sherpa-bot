import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
let messagePatchStatuses = new Map<string, number>();
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
    if (request.method === "PATCH" && existingId !== undefined) {
      const status = messagePatchStatuses.get(existingId) ?? 200;
      if (status !== 200) return new Response(null, { status });
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

function requestModal(
  interactionId: string,
  gameMode: "pvp-seasonal" | "pvp" | "pve" = "pve",
  legacy = false,
  mapId = "customs",
) {
  const text = (customId: string, value: string) => ({
    type: 18,
    component: { type: 4, custom_id: customId, value },
  });
  return context({
    id: interactionId,
    type: 5,
    data: {
      custom_id: legacy ? "request:create:v1" : `request:create:v2:${gameMode}`,
      components: [
        text("request:twitch-name", "TwitchViewer"),
        text("request:in-game-name", "Helpful PMC"),
        { type: 18, component: { type: 3, custom_id: "request:map", values: [mapId] } },
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
  const planned = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids[0] as StaffBoardRaid;
  await repo.reviewRaid({ groupId: planned.id, changedAt });
  const reviewMessageId = input.staffMessageId ?? `seed-review-${planned.id}`;
  await repo.compareAndSetRaidStaffMessage({
    groupId: planned.id,
    messageId: reviewMessageId,
    changedAt,
  });
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
  if (input.staffMessageId === undefined) {
    await repo.compareAndSetRaidStaffMessage({
      groupId: raid.id,
      expectedMessageId: reviewMessageId,
      changedAt,
    });
    raid = (await repo.getRaid(raid.id)) as StaffBoardRaid;
  }
  await repo.setCanonicalBoardMessage({ messageId: "canonical-board", changedAt });
  return { repo, raid };
}

async function activateRaid(input: {
  repo: D1MvpRepository;
  raid: StaffBoardRaid;
  leaderDiscordUserId: string;
  leaderType?: "streamer" | "volunteer";
  requestTwitchCall?: boolean;
  staffMessageId: string;
}): Promise<StaffBoardRaid> {
  await input.repo.reviewRaid({ groupId: input.raid.id, changedAt });
  await input.repo.compareAndSetRaidStaffMessage({
    groupId: input.raid.id,
    messageId: input.staffMessageId,
    changedAt,
  });
  return input.repo.startRaid({
    groupId: input.raid.id,
    leaderDiscordUserId: input.leaderDiscordUserId,
    leaderType: input.leaderType ?? "volunteer",
    requestTwitchCall: input.requestTwitchCall ?? false,
    canOverrideReservedLeader: input.leaderType === "streamer",
    changedAt,
  });
}

async function createRepositoryRequest(
  repo: D1MvpRepository,
  index: number,
  mapId = "customs",
): Promise<number> {
  const created = await repo.createRequest({
    sourcePlatform: "twitch",
    sourceDeliveryId: `pull-delivery-${index}`,
    twitchUserId: `pull-twitch-${index}`,
    twitchLogin: `pull_viewer_${index}`,
    gameMode: "pve",
    inGameName: `Pull PMC ${index}`,
    mapId,
    objective: `Pull goal ${index}`,
    recipientLimit: 4,
    observedAt: new Date(changedAt.getTime() + index),
  });
  return created.request.id;
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

beforeEach(() => {
  vi.restoreAllMocks();
  outbound = [];
  messageSequence = 0;
  deleteResponseStatus = 204;
  createResponseStatus = 200;
  messagePatchStatuses = new Map();
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
    const missingMode = await worker.fetch(
      await signedRequest(context({ type: 2, data: { type: 1, name: "request" } })),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await missingMode.json()).toMatchObject({
      type: 4,
      data: { content: expect.stringContaining("Select PvP Seasonal, PvP, or PvE") },
    });
    const command = await signedRequest(
      context({
        type: 2,
        data: {
          type: 1,
          name: "request",
          options: [{ name: "mode", type: 3, value: "pve" }],
        },
      }),
    );
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
      data: {
        content: "Your help request for PvE · Customs is in the queue. Use `/queue` to check it.",
      },
    });
    const duplicate = await worker.fetch(
      await signedRequest(requestModal("create-request")),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await duplicate.json()).toMatchObject({
      data: {
        content: "Your help request for PvE · Customs is in the queue. Use `/queue` to check it.",
      },
    });
    await expect(
      env.DB.prepare(
        `SELECT count(*) AS count FROM event_receipts
         WHERE platform = 0 AND delivery_id = 'create-request'`,
      ).first(),
    ).resolves.toEqual({ count: 0 });
    await expect(
      env.DB.prepare(
        `SELECT count(*) AS count FROM help_requests
         WHERE source_platform = 0 AND source_delivery_id = 'create-request'`,
      ).first(),
    ).resolves.toEqual({ count: 1 });
  });

  it("accepts a legacy request modal as PvE", async () => {
    const response = await worker.fetch(
      await signedRequest(requestModal("legacy-request", "pvp", true)),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await response.json()).toMatchObject({
      data: { content: expect.stringContaining("PvE · Customs") },
    });
    expect(
      await env.DB.prepare(
        `SELECT game_mode AS gameMode FROM help_requests WHERE source_delivery_id = 'legacy-request'`,
      ).first(),
    ).toEqual({ gameMode: 2 });
  });

  it("rejects invalid new modal mode state with private retry guidance", async () => {
    const invalid = requestModal("invalid-mode") as Record<string, unknown>;
    const data = invalid.data as Record<string, unknown>;
    data.custom_id = "request:create:v2:invalid";
    const response = await worker.fetch(
      await signedRequest(invalid),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await response.json()).toMatchObject({
      type: 4,
      data: { content: "Select a valid game mode and open `/request` again.", flags: 64 },
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
        content: "PvE · Customs: 1st in the PvE queue, no raids ahead.",
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

  it("reviews one raid before a volunteer calls, starts, and advances its attempt", async () => {
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
    const review = await worker.fetch(
      await signedRequest(
        context({
          ...staff,
          id: "review",
          type: 3,
          data: { custom_id: "board:v6:review", values: [String(raidId)] },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(review.status).toBe(200);
    expect(await review.json()).toMatchObject({
      type: 4,
      data: { content: expect.stringContaining("/message-2") },
    });
    expect(outbound.some((request) => request.url.includes(config.discord.requestChannelId))).toBe(
      false,
    );
    expect(await repo.getRaid(raidId ?? 0)).toMatchObject({
      state: "planned",
      automaticFill: false,
      attemptCount: 0,
      discordCallStatus: "not_requested",
      twitchCallStatus: "not_requested",
      staffMessageId: "message-2",
    });
    const reviewMessage = outbound.find(
      (request) =>
        request.method === "POST" &&
        request.url.includes(`/channels/${config.discord.staffChannelId}/messages`) &&
        JSON.stringify(request.body).includes("review this proposed raid"),
    );
    expect(reviewMessage?.body).toMatchObject({
      content: "<@volunteer> review this proposed raid.",
      allowed_mentions: { parse: [], users: ["volunteer"] },
    });
    const start = await worker.fetch(
      await signedRequest(
        context({
          ...staff,
          id: "start",
          type: 3,
          data: { custom_id: `raid:v2:call:${raidId}`, values: [] },
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
      content: expect.stringContaining("Starting PvE · Customs"),
      allowed_mentions: { parse: [], users: ["volunteer", "requester"] },
    });
    expect(requestCall?.body.content).not.toEqual(expect.stringContaining("Bring:"));
    let raid = await repo.getRaid(raidId ?? 0);
    expect(raid).toMatchObject({
      state: "active",
      attemptCount: 1,
      leaderDiscordUserId: "volunteer",
      discordCallStatus: "sent",
      twitchCallStatus: "not_requested",
      staffMessageId: "message-2",
    });
    const result = await worker.fetch(
      await signedRequest(
        context({
          ...staff,
          id: "attempt-two",
          type: 3,
          data: { custom_id: `raid:v2:result:${raidId}`, values: ["unsuccessful"] },
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

  it("reuses one review message and resolves concurrent review candidates", async () => {
    await worker.fetch(
      await signedRequest(requestModal("concurrent-review-request")),
      testEnvironment,
      createExecutionContext(),
    );
    const repo = new D1MvpRepository(env.DB);
    const raidId = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids[0]?.id ?? 0;
    const reviewRequest = async (id: string, userId: string) =>
      worker.fetch(
        await signedRequest(
          context({
            channel_id: config.discord.staffChannelId,
            member: {
              user: { id: userId, username: userId },
              roles: [config.discord.volunteerRoleId],
            },
            id,
            type: 3,
            data: { custom_id: "board:v6:review", values: [String(raidId)] },
          }),
        ),
        testEnvironment,
        createExecutionContext(),
      );
    createBarrierTarget = 2;

    const responses = await Promise.all([
      reviewRequest("concurrent-review-one", "volunteer-one"),
      reviewRequest("concurrent-review-two", "volunteer-two"),
    ]);

    const creates = outbound.filter((request) => request.method === "POST");
    const deletes = outbound.filter((request) => request.method === "DELETE");
    expect(creates).toHaveLength(2);
    expect(deletes).toHaveLength(1);
    const retained = await repo.getRaid(raidId);
    expect(retained).toMatchObject({ state: "planned", automaticFill: false });
    expect(retained?.staffMessageId).toMatch(/^message-[12]$/);
    for (const response of responses) {
      expect(await response.json()).toMatchObject({
        type: 4,
        data: { content: expect.stringContaining(`/${retained?.staffMessageId}`) },
      });
    }

    outbound = [];
    const repeated = await reviewRequest("repeat-review", "volunteer-one");
    expect(await repeated.json()).toMatchObject({
      type: 4,
      data: { content: expect.stringContaining(`/${retained?.staffMessageId}`) },
    });
    expect(outbound.filter((request) => request.method === "POST")).toHaveLength(0);
  });

  it("moves a requester during review without calling or starting the raid", async () => {
    await worker.fetch(
      await signedRequest(requestModal("review-move-first")),
      testEnvironment,
      createExecutionContext(),
    );
    const repo = new D1MvpRepository(env.DB);
    await repo.createRequest({
      sourcePlatform: "twitch",
      sourceDeliveryId: "review-move-second",
      twitchUserId: "review-move-twitch",
      twitchLogin: "second_viewer",
      gameMode: "pve",
      inGameName: "Second PMC",
      mapId: "customs",
      objective: "Second goal",
      recipientLimit: config.policies.recipientLimit,
      observedAt: changedAt,
    });
    const planned = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids[0] as StaffBoardRaid;
    const staff = {
      channel_id: config.discord.staffChannelId,
      member: {
        user: { id: "volunteer", username: "Volunteer" },
        roles: [config.discord.volunteerRoleId],
      },
    };
    await worker.fetch(
      await signedRequest(
        context({
          ...staff,
          id: "review-before-move",
          type: 3,
          data: { custom_id: "board:v6:review", values: [String(planned.id)] },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    outbound = [];
    const movedRequestId = planned.members[1]?.requestId;
    const moved = await worker.fetch(
      await signedRequest(
        context({
          ...staff,
          id: "move-before-call",
          type: 3,
          data: {
            custom_id: `raid:v2:postpone:${planned.id}`,
            values: [String(movedRequestId)],
          },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    const movedBody = await moved.json();
    expect(movedBody).toMatchObject({
      type: 7,
      data: {
        embeds: [
          expect.objectContaining({ description: expect.stringContaining("Planned review") }),
        ],
      },
    });
    expect(JSON.stringify(movedBody)).toContain("Pull requester up");
    const source = await repo.getRaid(planned.id);
    expect(source).toMatchObject({
      state: "planned",
      automaticFill: false,
      attemptCount: 0,
      discordCallStatus: "not_requested",
      twitchCallStatus: "not_requested",
    });
    expect(source?.members).toHaveLength(1);
    expect(outbound.some((request) => request.url.includes(config.discord.requestChannelId))).toBe(
      false,
    );
  });

  it("refresh replaces retired board controls with the current review controls", async () => {
    await worker.fetch(
      await signedRequest(requestModal("refresh-controls-request")),
      testEnvironment,
      createExecutionContext(),
    );
    const repo = new D1MvpRepository(env.DB);
    await repo.setCanonicalBoardMessage({ messageId: "canonical-board", changedAt });

    const response = await refreshBoard("refresh-old-controls");
    const body = JSON.stringify(await response.json());
    expect(body).toContain("board:v6:refresh");
    expect(body).toContain("board:v6:review");
    expect(body).toContain("Review a raid");
    expect(body).not.toContain("board:v5:start");
    expect(body).not.toContain("Start a raid");
  });

  it("rejects the retired immediate-start selector with refresh guidance", async () => {
    const response = await worker.fetch(
      await signedRequest(
        context({
          channel_id: config.discord.staffChannelId,
          member: {
            user: { id: "volunteer", username: "Volunteer" },
            roles: [config.discord.volunteerRoleId],
          },
          id: "retired-start",
          type: 3,
          data: { custom_id: "board:v5:start", values: ["1"] },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await response.json()).toMatchObject({
      type: 4,
      data: { content: expect.stringContaining("Use Refresh") },
    });
  });

  it.each([
    ["the-lab", "pvp-seasonal", "PvP Seasonal · The Lab", "TerraGroup Labs access keycard"],
    ["the-labyrinth", "pvp", "PvP · The Labyrinth", "Knossos LLC facility key"],
    ["terminal", "pve", "PvE · Terminal", "Prapor's letter for the port checkpoint"],
    ["icebreaker", "pve", "PvE · Icebreaker", "current Euro exit fee"],
  ] as const)(
    "adds the %s preparation reminder to streamer-led Discord and Twitch calls",
    async (mapId, gameMode, raidName, expectedReminder) => {
      await worker.fetch(
        await signedRequest(requestModal(`streamer-call-request-${mapId}`, gameMode, false, mapId)),
        testEnvironment,
        createExecutionContext(),
      );
      const repo = new D1MvpRepository(env.DB);
      const raid = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids[0] as StaffBoardRaid;
      const twitchFetch = vi
        .spyOn(globalThis, "fetch")
        .mockResolvedValue(
          Response.json({ data: [{ message_id: "call-message", is_sent: true }] }),
        );
      const staff = {
        channel_id: config.discord.staffChannelId,
        member: { user: { id: config.discord.streamerUserId, username: "Streamer" }, roles: [] },
      };
      await worker.fetch(
        await signedRequest(
          context({
            ...staff,
            id: `streamer-review-${mapId}`,
            type: 3,
            data: { custom_id: "board:v6:review", values: [String(raid.id)] },
          }),
        ),
        testEnvironment,
        createExecutionContext(),
      );
      const response = await worker.fetch(
        await signedRequest(
          context({
            ...staff,
            id: `streamer-start-${mapId}`,
            type: 3,
            data: { custom_id: `raid:v2:call:${raid.id}`, values: [] },
          }),
        ),
        testEnvironment,
        createExecutionContext(),
      );
      expect(response.status).toBe(200);
      const discordCall = outbound.find((request) =>
        request.url.includes(`/channels/${config.discord.requestChannelId}/messages`),
      );
      expect(discordCall?.body).toMatchObject({
        content: expect.stringContaining(`Starting ${raidName}`),
        allowed_mentions: { parse: [], users: [config.discord.streamerUserId, "requester"] },
      });
      expect(discordCall?.body.content).toEqual(expect.stringContaining("Bring:"));
      expect(discordCall?.body.content).toEqual(expect.stringContaining(expectedReminder));
      const twitchBody = twitchFetch.mock.calls[0]?.[1]?.body;
      const twitchMessage =
        typeof twitchBody === "string"
          ? ((JSON.parse(twitchBody) as { message?: string }).message ?? "")
          : "";
      expect(twitchMessage).toContain(`Starting ${raidName}`);
      expect(twitchMessage).toContain("@twitchviewer");
      expect(twitchMessage).toContain("Bring:");
      expect(twitchMessage).toContain(expectedReminder);
      expect(await repo.getRaid(raid.id)).toMatchObject({
        state: "active",
        discordCallStatus: "sent",
        twitchCallStatus: "sent",
      });
      twitchFetch.mockRestore();
    },
  );

  it("keeps the raid active and reports partial call delivery failure", async () => {
    await worker.fetch(
      await signedRequest(requestModal("partial-call-request")),
      testEnvironment,
      createExecutionContext(),
    );
    const repo = new D1MvpRepository(env.DB);
    const raid = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids[0] as StaffBoardRaid;
    const staff = {
      channel_id: config.discord.staffChannelId,
      member: { user: { id: config.discord.streamerUserId, username: "Streamer" }, roles: [] },
    };
    await worker.fetch(
      await signedRequest(
        context({
          ...staff,
          id: "partial-call-review",
          type: 3,
          data: { custom_id: "board:v6:review", values: [String(raid.id)] },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    createResponseStatus = 500;
    const twitchFetch = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(Response.json({ data: [{ message_id: "partial-call", is_sent: true }] }));

    const response = await worker.fetch(
      await signedRequest(
        context({
          ...staff,
          id: "partial-call-start",
          type: 3,
          data: { custom_id: `raid:v2:call:${raid.id}`, values: [] },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );

    expect(await response.json()).toMatchObject({
      type: 7,
      data: {
        embeds: [
          expect.objectContaining({
            description: expect.stringContaining("Discord failed · Twitch sent"),
          }),
        ],
      },
    });
    expect(await repo.getRaid(raid.id)).toMatchObject({
      state: "active",
      leaderDiscordUserId: config.discord.streamerUserId,
      discordCallStatus: "failed",
      twitchCallStatus: "sent",
    });
    twitchFetch.mockRestore();
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
    messagePatchStatuses.set("deleted-detail", 404);

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

  it("dismisses a deleted planned review without assigning a leader or calling users", async () => {
    await worker.fetch(
      await signedRequest(requestModal("repair-planned-review")),
      testEnvironment,
      createExecutionContext(),
    );
    const repo = new D1MvpRepository(env.DB);
    const planned = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids[0] as StaffBoardRaid;
    await repo.reviewRaid({ groupId: planned.id, changedAt });
    await repo.compareAndSetRaidStaffMessage({
      groupId: planned.id,
      messageId: "deleted-planned-detail",
      changedAt,
    });
    await repo.setCanonicalBoardMessage({ messageId: "canonical-board", changedAt });
    messagePatchStatuses.set("deleted-planned-detail", 404);
    outbound = [];

    await refreshBoard("refresh-deleted-planned");

    const repaired = await repo.getRaid(planned.id);
    expect(repaired).toMatchObject({
      state: "planned",
      automaticFill: false,
      attemptCount: 0,
      discordCallStatus: "not_requested",
      twitchCallStatus: "not_requested",
    });
    expect(repaired?.staffMessageId).toBeUndefined();
    expect(repaired?.leaderDiscordUserId).toBeUndefined();
    expect(outbound.some((request) => request.method === "POST")).toBe(false);
    const canonicalUpdate = outbound.find(
      (request) => request.method === "PATCH" && request.url.endsWith("/canonical-board"),
    );
    expect(JSON.stringify(canonicalUpdate?.body)).not.toContain("/deleted-planned-detail");
    expect(outbound.some((request) => request.url.includes(config.discord.requestChannelId))).toBe(
      false,
    );
  });

  it("dismisses a deleted planned detail when staff review the raid again", async () => {
    await worker.fetch(
      await signedRequest(requestModal("repair-repeat-review")),
      testEnvironment,
      createExecutionContext(),
    );
    const repo = new D1MvpRepository(env.DB);
    const planned = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids[0] as StaffBoardRaid;
    await repo.reviewRaid({ groupId: planned.id, changedAt });
    await repo.compareAndSetRaidStaffMessage({
      groupId: planned.id,
      messageId: "deleted-repeat-review",
      changedAt,
    });
    messagePatchStatuses.set("deleted-repeat-review", 404);
    outbound = [];

    const response = await worker.fetch(
      await signedRequest(
        context({
          id: "repeat-deleted-review",
          type: 3,
          channel_id: config.discord.staffChannelId,
          member: {
            user: { id: "volunteer", username: "Volunteer" },
            roles: [config.discord.volunteerRoleId],
          },
          data: { custom_id: "board:v6:review", values: [String(planned.id)] },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );

    expect(await response.json()).toMatchObject({
      type: 4,
      data: { content: expect.stringContaining("raid is back on the board"), flags: 64 },
    });
    expect(await repo.getRaid(planned.id)).toMatchObject({
      state: "planned",
      automaticFill: false,
      attemptCount: 0,
    });
    expect((await repo.getRaid(planned.id))?.staffMessageId).toBeUndefined();
    expect(outbound.some((request) => request.method === "POST")).toBe(false);
    expect(outbound.some((request) => request.url.includes(config.discord.requestChannelId))).toBe(
      false,
    );
  });

  it("clears one stale link when deleted-detail review actions overlap", async () => {
    await worker.fetch(
      await signedRequest(requestModal("repair-concurrent-repeat-review")),
      testEnvironment,
      createExecutionContext(),
    );
    const repo = new D1MvpRepository(env.DB);
    const planned = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids[0] as StaffBoardRaid;
    await repo.reviewRaid({ groupId: planned.id, changedAt });
    await repo.compareAndSetRaidStaffMessage({
      groupId: planned.id,
      messageId: "deleted-concurrent-review",
      changedAt,
    });
    messagePatchStatuses.set("deleted-concurrent-review", 404);
    outbound = [];
    const review = async (id: string) =>
      worker.fetch(
        await signedRequest(
          context({
            id,
            type: 3,
            channel_id: config.discord.staffChannelId,
            member: {
              user: { id: "volunteer", username: "Volunteer" },
              roles: [config.discord.volunteerRoleId],
            },
            data: { custom_id: "board:v6:review", values: [String(planned.id)] },
          }),
        ),
        testEnvironment,
        createExecutionContext(),
      );

    const responses = await Promise.all([
      review("concurrent-deleted-review-one"),
      review("concurrent-deleted-review-two"),
    ]);
    expect((await repo.getRaid(planned.id))?.staffMessageId).toBeUndefined();
    for (const response of responses) {
      expect(JSON.stringify(await response.json())).toContain("raid is back on the board");
    }
    expect(outbound.filter((request) => request.method === "POST")).toHaveLength(0);
    expect(outbound.filter((request) => request.method === "DELETE")).toHaveLength(0);
  });

  it("cancels one planned review without changing its raid or other details", async () => {
    const repo = new D1MvpRepository(env.DB);
    for (const [index, mapId] of ["customs", "woods"].entries()) {
      await repo.createRequest({
        sourcePlatform: "twitch",
        sourceDeliveryId: `cancel-review-${mapId}`,
        twitchUserId: `cancel-twitch-${index}`,
        twitchLogin: `cancel_viewer_${index}`,
        gameMode: "pve",
        inGameName: `Cancel PMC ${index}`,
        mapId,
        objective: `Cancel goal ${mapId}`,
        recipientLimit: config.policies.recipientLimit,
        observedAt: new Date(changedAt.getTime() + index),
      });
    }
    const raids = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids;
    const customs = raids.find((raid) => raid.mapId === "customs") as StaffBoardRaid;
    const woods = raids.find((raid) => raid.mapId === "woods") as StaffBoardRaid;
    await repo.reviewRaid({ groupId: customs.id, changedAt });
    await repo.reviewRaid({ groupId: woods.id, changedAt });
    await repo.compareAndSetRaidStaffMessage({
      groupId: customs.id,
      messageId: "cancel-customs-detail",
      changedAt,
    });
    await repo.compareAndSetRaidStaffMessage({
      groupId: woods.id,
      messageId: "keep-woods-detail",
      changedAt,
    });
    await repo.setCanonicalBoardMessage({ messageId: "canonical-board", changedAt });
    outbound = [];

    const executionContext = createExecutionContext();
    const response = await worker.fetch(
      await signedRequest(
        context({
          id: "cancel-planned-review",
          type: 3,
          channel_id: config.discord.staffChannelId,
          member: {
            user: { id: "volunteer", username: "Volunteer" },
            roles: [config.discord.volunteerRoleId],
          },
          message: { id: "cancel-customs-detail" },
          data: { custom_id: `raid:v3:cancel:${customs.id}`, values: [] },
        }),
      ),
      testEnvironment,
      executionContext,
    );
    await waitOnExecutionContext(executionContext);

    expect(await response.json()).toMatchObject({
      type: 4,
      data: { content: "Review closed. The raid is still on the board.", flags: 64 },
    });
    expect(await repo.getRaid(customs.id)).toMatchObject({
      state: "planned",
      automaticFill: false,
      attemptCount: 0,
      members: customs.members,
    });
    expect((await repo.getRaid(customs.id))?.staffMessageId).toBeUndefined();
    expect(await repo.getRaid(woods.id)).toMatchObject({
      state: "planned",
      staffMessageId: "keep-woods-detail",
      members: woods.members,
    });
    expect(outbound).toContainEqual(
      expect.objectContaining({
        method: "DELETE",
        url: expect.stringContaining("/messages/cancel-customs-detail"),
      }),
    );
    const boardUpdate = outbound.find(
      (request) => request.method === "PATCH" && request.url.endsWith("/canonical-board"),
    );
    expect(JSON.stringify(boardUpdate?.body)).not.toContain("/cancel-customs-detail");
    expect(JSON.stringify(boardUpdate?.body)).toContain("/keep-woods-detail");

    const repeated = await worker.fetch(
      await signedRequest(
        context({
          id: "cancel-planned-review-repeat",
          type: 3,
          channel_id: config.discord.staffChannelId,
          member: {
            user: { id: "volunteer", username: "Volunteer" },
            roles: [config.discord.volunteerRoleId],
          },
          message: { id: "cancel-customs-detail" },
          data: { custom_id: `raid:v3:cancel:${customs.id}`, values: [] },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(JSON.stringify(await repeated.json())).toContain("no longer available to cancel");
  });

  it("accepts a missing Cancel target and restores the link after another deletion error", async () => {
    await worker.fetch(
      await signedRequest(requestModal("cancel-delete-outcomes")),
      testEnvironment,
      createExecutionContext(),
    );
    const repo = new D1MvpRepository(env.DB);
    const planned = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids[0] as StaffBoardRaid;
    await repo.reviewRaid({ groupId: planned.id, changedAt });
    await repo.compareAndSetRaidStaffMessage({
      groupId: planned.id,
      messageId: "missing-cancel-detail",
      changedAt,
    });
    const cancel = async (id: string, messageId: string) =>
      worker.fetch(
        await signedRequest(
          context({
            id,
            type: 3,
            channel_id: config.discord.staffChannelId,
            member: {
              user: { id: "volunteer", username: "Volunteer" },
              roles: [config.discord.volunteerRoleId],
            },
            message: { id: messageId },
            data: { custom_id: `raid:v3:cancel:${planned.id}`, values: [] },
          }),
        ),
        testEnvironment,
        createExecutionContext(),
      );

    deleteResponseStatus = 404;
    const missing = await cancel("cancel-missing-detail", "missing-cancel-detail");
    expect(JSON.stringify(await missing.json())).toContain("Review closed");
    expect((await repo.getRaid(planned.id))?.staffMessageId).toBeUndefined();

    await repo.compareAndSetRaidStaffMessage({
      groupId: planned.id,
      messageId: "failed-cancel-detail",
      changedAt,
    });
    deleteResponseStatus = 500;
    const failed = await cancel("cancel-failed-detail", "failed-cancel-detail");
    expect(JSON.stringify(await failed.json())).toContain("could not close");
    expect(await repo.getRaid(planned.id)).toMatchObject({
      state: "planned",
      automaticFill: false,
      staffMessageId: "failed-cancel-detail",
    });
  });

  it("rejects stale and active Cancel review controls without deleting details", async () => {
    await worker.fetch(
      await signedRequest(requestModal("cancel-stale-active")),
      testEnvironment,
      createExecutionContext(),
    );
    const repo = new D1MvpRepository(env.DB);
    const planned = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids[0] as StaffBoardRaid;
    await repo.reviewRaid({ groupId: planned.id, changedAt });
    await repo.compareAndSetRaidStaffMessage({
      groupId: planned.id,
      messageId: "current-cancel-detail",
      changedAt,
    });
    const cancel = async (id: string, messageId: string) =>
      worker.fetch(
        await signedRequest(
          context({
            id,
            type: 3,
            channel_id: config.discord.staffChannelId,
            member: {
              user: { id: "volunteer", username: "Volunteer" },
              roles: [config.discord.volunteerRoleId],
            },
            message: { id: messageId },
            data: { custom_id: `raid:v3:cancel:${planned.id}`, values: [] },
          }),
        ),
        testEnvironment,
        createExecutionContext(),
      );

    outbound = [];
    const stale = await cancel("cancel-stale-control", "stale-cancel-detail");
    expect(JSON.stringify(await stale.json())).toContain("no longer available to cancel");
    expect((await repo.getRaid(planned.id))?.staffMessageId).toBe("current-cancel-detail");
    expect(outbound.some((request) => request.method === "DELETE")).toBe(false);

    await repo.startRaid({
      groupId: planned.id,
      leaderDiscordUserId: "volunteer",
      leaderType: "volunteer",
      requestTwitchCall: false,
      changedAt,
    });
    outbound = [];
    const active = await cancel("cancel-active-control", "current-cancel-detail");
    expect(JSON.stringify(await active.json())).toContain("no longer available to cancel");
    expect(await repo.getRaid(planned.id)).toMatchObject({
      state: "active",
      staffMessageId: "current-cancel-detail",
    });
    expect(outbound.some((request) => request.method === "DELETE")).toBe(false);
  });

  it("tracks multiple raid detail messages through recovery and independent actions", async () => {
    const repo = new D1MvpRepository(env.DB);
    for (const [index, mapId] of ["customs", "woods", "shoreline"].entries()) {
      await repo.createRequest({
        sourcePlatform: "twitch",
        sourceDeliveryId: `multi-detail-${mapId}`,
        twitchUserId: `multi-twitch-${index}`,
        twitchLogin: `multi_viewer_${index}`,
        gameMode: "pve",
        inGameName: `Multi PMC ${index}`,
        mapId,
        objective: `Goal for ${mapId}`,
        recipientLimit: config.policies.recipientLimit,
        observedAt: new Date(changedAt.getTime() + index),
      });
    }
    await repo.setCanonicalBoardMessage({ messageId: "canonical-board", changedAt });
    const staff = {
      channel_id: config.discord.staffChannelId,
      member: {
        user: { id: "volunteer", username: "Volunteer" },
        roles: [config.discord.volunteerRoleId],
      },
    };
    const component = async (id: string, customId: string, values: string[] = []) => {
      const executionContext = createExecutionContext();
      const response = await worker.fetch(
        await signedRequest(
          context({ ...staff, id, type: 3, data: { custom_id: customId, values } }),
        ),
        testEnvironment,
        executionContext,
      );
      await waitOnExecutionContext(executionContext);
      return response;
    };
    const initialRaids = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids;
    expect(initialRaids).toHaveLength(3);

    for (const raid of initialRaids) {
      const response = await component(`multi-review-${raid.mapId}`, "board:v6:review", [
        String(raid.id),
      ]);
      expect(response.status).toBe(200);
    }

    const reviewed = await Promise.all(initialRaids.map((raid) => repo.getRaid(raid.id)));
    const reviewedByMap = new Map(reviewed.map((raid) => [raid?.mapId, raid]));
    const messageIds = reviewed.map((raid) => raid?.staffMessageId);
    expect(new Set(messageIds).size).toBe(3);
    expect(messageIds.every((messageId) => messageId !== undefined)).toBe(true);
    for (const raid of reviewed) {
      expect(raid).toMatchObject({
        state: "planned",
        automaticFill: false,
        attemptCount: 0,
        discordCallStatus: "not_requested",
        twitchCallStatus: "not_requested",
      });
      const message = outbound.find(
        (request) =>
          request.method === "POST" &&
          JSON.stringify(request.body).includes(`Goal for ${raid?.mapId}`),
      );
      expect(JSON.stringify(message?.body)).toContain(
        raid?.mapId === "customs" ? "Customs" : raid?.mapId === "woods" ? "Woods" : "Shoreline",
      );
    }

    const customs = reviewedByMap.get("customs") as StaffBoardRaid;
    const woods = reviewedByMap.get("woods") as StaffBoardRaid;
    const shoreline = reviewedByMap.get("shoreline") as StaffBoardRaid;
    messagePatchStatuses.set(woods.staffMessageId as string, 404);
    outbound = [];
    await refreshBoard("multi-detail-refresh");

    const recoveredCustoms = (await repo.getRaid(customs.id)) as StaffBoardRaid;
    const recoveredWoods = (await repo.getRaid(woods.id)) as StaffBoardRaid;
    const recoveredShoreline = (await repo.getRaid(shoreline.id)) as StaffBoardRaid;
    expect(recoveredCustoms.staffMessageId).toBe(customs.staffMessageId);
    expect(recoveredShoreline.staffMessageId).toBe(shoreline.staffMessageId);
    expect(recoveredWoods.staffMessageId).toBeUndefined();
    expect(outbound.filter((request) => request.method === "POST")).toHaveLength(0);
    const refreshedBoard = outbound.find(
      (request) => request.method === "PATCH" && request.url.endsWith("/canonical-board"),
    );
    const refreshedBody = JSON.stringify(refreshedBoard?.body);
    expect(refreshedBody).toContain(`/${recoveredCustoms.staffMessageId}`);
    expect(refreshedBody).toContain(`/${recoveredShoreline.staffMessageId}`);
    expect(refreshedBody).not.toContain(`/${woods.staffMessageId}`);

    await component("multi-rereview-woods", "board:v6:review", [String(woods.id)]);
    const reviewedWoodsAgain = (await repo.getRaid(woods.id)) as StaffBoardRaid;
    expect(reviewedWoodsAgain.staffMessageId).toMatch(/^message-/);

    outbound = [];
    await component("multi-start-customs", `raid:v2:call:${customs.id}`);
    expect(await repo.getRaid(customs.id)).toMatchObject({
      state: "active",
      leaderDiscordUserId: "volunteer",
      attemptCount: 1,
    });
    expect(await repo.getRaid(woods.id)).toMatchObject({ state: "planned", attemptCount: 0 });
    expect(await repo.getRaid(shoreline.id)).toMatchObject({ state: "planned", attemptCount: 0 });

    await component("multi-remove-shoreline", `raid:v2:remove:${shoreline.id}`, [
      String(shoreline.members[0]?.requestId),
    ]);
    expect(await repo.getRaid(shoreline.id)).toMatchObject({
      state: "canceled",
      outcome: "not_run",
    });
    expect(await repo.getRaid(customs.id)).toMatchObject({ state: "active", attemptCount: 1 });

    await component("multi-move-woods", `raid:v2:postpone:${woods.id}`, [
      String(woods.members[0]?.requestId),
    ]);
    expect(await repo.getRaid(woods.id)).toMatchObject({ state: "canceled", outcome: "not_run" });
    const woodsFollowUp = (await repo.getBoardSnapshot(changedAt)).ordinaryRaids.find(
      (raid) => raid.mapId === "woods",
    );
    expect(woodsFollowUp).toMatchObject({ state: "planned", automaticFill: true });

    await component("multi-help-customs", `raid:v2:result:${customs.id}`, ["helped"]);
    expect(await repo.getRaid(customs.id)).toMatchObject({ state: "completed", outcome: "helped" });
    const deletedUrls = outbound
      .filter((request) => request.method === "DELETE")
      .map((request) => request.url);
    expect(deletedUrls.some((url) => url.endsWith(`/${recoveredCustoms.staffMessageId}`))).toBe(
      true,
    );
    expect(deletedUrls.some((url) => url.endsWith(`/${reviewedWoodsAgain.staffMessageId}`))).toBe(
      true,
    );
    expect(deletedUrls.some((url) => url.endsWith(`/${recoveredShoreline.staffMessageId}`))).toBe(
      true,
    );
  });

  it("retains an active message identity on a temporary Discord update failure", async () => {
    const { repo, raid } = await seedActiveRaid({
      interactionId: "retain-temporary",
      staffMessageId: "temporary-detail",
    });
    messagePatchStatuses.set("temporary-detail", 500);

    await refreshBoard("refresh-temporary");

    expect((await repo.getRaid(raid.id))?.staffMessageId).toBe("temporary-detail");
    expect(outbound.filter((request) => request.method === "POST")).toHaveLength(0);
    const canonicalUpdate = outbound.find(
      (request) => request.method === "PATCH" && request.url.endsWith("/canonical-board"),
    );
    expect(JSON.stringify(canonicalUpdate?.body)).toContain("/temporary-detail");
  });

  it("retains a confirmed dead link so replacement creation can retry", async () => {
    const { repo, raid } = await seedActiveRaid({
      interactionId: "failed-replacement",
      staffMessageId: "dead-detail",
    });
    messagePatchStatuses.set("dead-detail", 404);
    createResponseStatus = 500;

    await refreshBoard("refresh-failed-replacement");

    expect((await repo.getRaid(raid.id))?.staffMessageId).toBe("dead-detail");
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
    await activateRaid({
      repo,
      raid,
      leaderDiscordUserId: "volunteer",
      staffMessageId: "postpone-last-message",
    });
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
    await activateRaid({
      repo,
      raid,
      leaderDiscordUserId: "volunteer",
      staffMessageId: "remove-last-message",
    });
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
    await activateRaid({
      repo,
      raid,
      leaderDiscordUserId: "volunteer",
      staffMessageId: "postpone-whole-message",
    });
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
    const raid = (await repo.getRaid(raidId)) as StaffBoardRaid;
    await activateRaid({
      repo,
      raid,
      leaderDiscordUserId: "assigned-leader",
      staffMessageId: "assigned-detail",
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

describe("Discord requester pull-up workflow", () => {
  function pullInteraction(input: {
    id: string;
    customId: string;
    values?: string[];
    discordUserId?: string;
    roleIds?: string[];
  }) {
    return context({
      channel_id: config.discord.staffChannelId,
      member: {
        user: { id: input.discordUserId ?? config.discord.streamerUserId, username: "Staff" },
        roles: input.roleIds ?? [],
      },
      id: input.id,
      type: 3,
      data: { custom_id: input.customId, values: input.values ?? [] },
    });
  }

  async function reviewedDestinationWithSource(input: {
    requestCount?: number;
    messageId: string;
  }): Promise<{
    repo: D1MvpRepository;
    destination: StaffBoardRaid;
    source: StaffBoardRaid;
  }> {
    const repo = new D1MvpRepository(env.DB);
    for (let index = 1; index <= (input.requestCount ?? 5); index += 1) {
      await createRepositoryRequest(repo, index);
    }
    const [first, source] = (await repo.getBoardSnapshot()).ordinaryRaids;
    await repo.reviewRaid({ groupId: first?.id as number, changedAt });
    await repo.compareAndSetRaidStaffMessage({
      groupId: first?.id as number,
      messageId: input.messageId,
      changedAt,
    });
    const reviewed = (await repo.getRaid(first?.id as number)) as StaffBoardRaid;
    await repo.removeRequester({
      groupId: reviewed.id,
      requestId: reviewed.members[0]?.requestId as number,
      actionKey: `${input.messageId}-open-seat`,
      changedAt,
    });
    await repo.setCanonicalBoardMessage({ messageId: "canonical-pull-board", changedAt });
    return {
      repo,
      destination: (await repo.getRaid(reviewed.id)) as StaffBoardRaid,
      source: source as StaffBoardRaid,
    };
  }

  it("shows Twitch nicknames with goals and pulls without starting or calling", async () => {
    const { repo, destination, source } = await reviewedDestinationWithSource({
      messageId: "pull-detail",
    });
    outbound = [];
    const reviewResponse = await worker.fetch(
      await signedRequest(
        pullInteraction({
          id: "refresh-pull-selector",
          customId: "board:v6:review",
          values: [String(destination.id)],
          discordUserId: "volunteer",
          roleIds: [config.discord.volunteerRoleId],
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await reviewResponse.json()).toMatchObject({
      type: 4,
      data: { content: expect.stringContaining("/pull-detail"), flags: 64 },
    });
    const detailUpdate = outbound.find(
      (request) => request.method === "PATCH" && request.url.endsWith("/pull-detail"),
    );
    expect(detailUpdate).toBeDefined();
    const rows = (detailUpdate?.body.components ?? []) as Array<{
      components: Array<Record<string, unknown>>;
    }>;
    const selector = rows
      .flatMap((row) => row.components)
      .find((component) => component.custom_id === `raid:v3:pull:${destination.id}:${source.id}`);
    expect(selector).toMatchObject({
      placeholder: "Pull requester up",
      options: [
        {
          label: `@${source.members[0]?.twitchLogin}`,
          description: source.members[0]?.objective,
          value: String(source.members[0]?.requestId),
        },
      ],
    });

    outbound = [];
    const executionContext = createExecutionContext();
    const pullResponse = await worker.fetch(
      await signedRequest(
        pullInteraction({
          id: "pull-selected",
          customId: `raid:v3:pull:${destination.id}:${source.id}`,
          values: [String(source.members[0]?.requestId)],
        }),
      ),
      testEnvironment,
      executionContext,
    );
    await waitOnExecutionContext(executionContext);
    expect(await pullResponse.json()).toMatchObject({
      type: 4,
      data: {
        content: "Requester pulled up. The empty source raid was closed.",
        flags: 64,
      },
    });
    expect(outbound).toContainEqual(
      expect.objectContaining({
        method: "PATCH",
        url: expect.stringContaining("/messages/pull-detail"),
      }),
    );
    expect(outbound).toContainEqual(
      expect.objectContaining({
        method: "PATCH",
        url: expect.stringContaining("/messages/canonical-pull-board"),
      }),
    );
    expect(
      outbound.some(
        (request) =>
          request.method === "POST" &&
          request.url.includes(`/channels/${config.discord.requestChannelId}/messages`),
      ),
    ).toBe(false);
    expect(await repo.getRaid(destination.id)).toMatchObject({
      state: "planned",
      attemptCount: 0,
      discordCallStatus: "not_requested",
      twitchCallStatus: "not_requested",
    });

    const duplicate = await worker.fetch(
      await signedRequest(
        pullInteraction({
          id: "pull-selected",
          customId: `raid:v3:pull:${destination.id}:${source.id}`,
          values: [String(source.members[0]?.requestId)],
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await duplicate.json()).toMatchObject({
      type: 4,
      data: { content: "That action was already received." },
    });
  });

  it("does not offer or move members of a concurrent volunteer-led active raid", async () => {
    const repo = new D1MvpRepository(env.DB);
    for (let index = 1; index <= 9; index += 1) await createRepositoryRequest(repo, index);
    const [first, volunteerPlanned, later] = (await repo.getBoardSnapshot()).ordinaryRaids;
    const active = await activateRaid({
      repo,
      raid: volunteerPlanned as StaffBoardRaid,
      leaderDiscordUserId: "volunteer",
      staffMessageId: "volunteer-active-detail",
    });
    const activeRequestIds = active.members.map((member) => member.requestId);
    await repo.reviewRaid({ groupId: first?.id as number, changedAt });
    await repo.compareAndSetRaidStaffMessage({
      groupId: first?.id as number,
      messageId: "streamer-review-detail",
      changedAt,
    });
    const destination = (await repo.getRaid(first?.id as number)) as StaffBoardRaid;
    await repo.removeRequester({
      groupId: destination.id,
      requestId: destination.members[0]?.requestId as number,
      actionKey: "streamer-review-open-seat",
      changedAt,
    });

    const response = await worker.fetch(
      await signedRequest(
        pullInteraction({
          id: "active-source-excluded",
          customId: `raid:v3:pull_candidates:${destination.id}`,
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    const body = JSON.stringify(await response.json());
    expect(body).toContain(`raid:v3:pull:${destination.id}:${later?.id}`);
    for (const requestId of activeRequestIds) expect(body).not.toContain(`"value":"${requestId}"`);

    await worker.fetch(
      await signedRequest(
        pullInteraction({
          id: "pull-past-active-source",
          customId: `raid:v3:pull:${destination.id}:${later?.id}`,
          values: [String(later?.members[0]?.requestId)],
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect((await repo.getRaid(active.id))?.members.map((member) => member.requestId)).toEqual(
      activeRequestIds,
    );
    expect((await repo.getRaid(active.id))?.state).toBe("active");
    expect(
      outbound.some((request) => request.url.includes("/messages/volunteer-active-detail")),
    ).toBe(false);
  });

  it("reports when a non-fitting source remainder stays in place", async () => {
    const { repo, destination, source } = await reviewedDestinationWithSource({
      requestCount: 10,
      messageId: "retained-pull-detail",
    });
    const sourceRemainder = source.members.slice(1).map((member) => member.requestId);
    const response = await worker.fetch(
      await signedRequest(
        pullInteraction({
          id: "retained-pull",
          customId: `raid:v3:pull:${destination.id}:${source.id}`,
          values: [String(source.members[0]?.requestId)],
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await response.json()).toMatchObject({
      type: 4,
      data: {
        content: "Requester pulled up. The remaining source raid stayed in place.",
        flags: 64,
      },
    });
    expect((await repo.getRaid(source.id))?.members.map((member) => member.requestId)).toEqual(
      sourceRemainder,
    );
  });

  it("returns a short response when no safe source is available", async () => {
    const { repo, destination, source } = await reviewedDestinationWithSource({
      messageId: "no-source-pull-detail",
    });
    await repo.reviewRaid({ groupId: source.id, changedAt });
    outbound = [];
    await worker.fetch(
      await signedRequest(
        pullInteraction({
          id: "render-no-pull-source",
          customId: "board:v6:review",
          values: [String(destination.id)],
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    const detailUpdate = outbound.find(
      (request) => request.method === "PATCH" && request.url.endsWith("/no-source-pull-detail"),
    );
    const rows = (detailUpdate?.body.components ?? []) as Array<{
      components: Array<Record<string, unknown>>;
    }>;
    const unavailable = rows
      .flatMap((row) => row.components)
      .find((component) => component.placeholder === "Pull requester up");
    expect(unavailable).toMatchObject({
      disabled: true,
      options: [{ label: "No compatible requester available", value: "unavailable" }],
    });
    const response = await worker.fetch(
      await signedRequest(
        pullInteraction({
          id: "no-pull-source",
          customId: `raid:v3:pull_candidates:${destination.id}`,
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await response.json()).toMatchObject({
      type: 4,
      data: { content: "No later requester is available for this raid." },
    });
  });

  it("dismisses a manually deleted destination detail after a pull", async () => {
    const { repo, destination, source } = await reviewedDestinationWithSource({
      messageId: "deleted-pull-detail",
    });
    messagePatchStatuses.set("deleted-pull-detail", 404);
    const response = await worker.fetch(
      await signedRequest(
        pullInteraction({
          id: "pull-deleted-detail",
          customId: `raid:v3:pull:${destination.id}:${source.id}`,
          values: [String(source.members[0]?.requestId)],
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await response.json()).toMatchObject({
      type: 4,
      data: { content: expect.stringContaining("Requester pulled up"), flags: 64 },
    });
    expect((await repo.getRaid(destination.id))?.staffMessageId).toBeUndefined();
    expect(outbound.some((request) => request.method === "POST")).toBe(false);
  });

  it("denies pull controls to a non-staff user", async () => {
    const { destination } = await reviewedDestinationWithSource({
      messageId: "denied-pull-detail",
    });
    const response = await worker.fetch(
      await signedRequest(
        pullInteraction({
          id: "denied-pull",
          customId: `raid:v3:pull_candidates:${destination.id}`,
          discordUserId: "viewer",
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await response.json()).toMatchObject({
      type: 4,
      data: { content: "Only the streamer or a volunteer sherpa can use these controls." },
    });
  });
});

describe("Discord staff insights workflow", () => {
  function staffCommand(name: "stats" | "users", staff = true) {
    return context({
      channel_id: config.discord.staffChannelId,
      id: `${name}-${staff ? "staff" : "viewer"}`,
      type: 2,
      member: staff
        ? {
            user: { id: "volunteer", username: "Volunteer" },
            roles: [config.discord.volunteerRoleId],
          }
        : { user: { id: "viewer", username: "Viewer" }, roles: [] },
      data: { type: 1, name },
    });
  }

  function staffInsightsInteraction(overrides: Record<string, unknown>) {
    return context({
      channel_id: config.discord.staffChannelId,
      member: {
        user: { id: "volunteer", username: "Volunteer" },
        roles: [config.discord.volunteerRoleId],
      },
      ...overrides,
    });
  }

  it.each(["stats", "users"] as const)("denies /%s without revealing data", async (name) => {
    const response = await worker.fetch(
      await signedRequest(staffCommand(name, false)),
      testEnvironment,
      createExecutionContext(),
    );
    const body = (await response.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      type: 4,
      data: { content: expect.stringContaining("streamer or a volunteer"), flags: 64 },
    });
    expect(JSON.stringify(body)).not.toContain("embeds");
  });

  it.each(["stats", "users"] as const)("denies /%s outside the staff channel", async (name) => {
    const response = await worker.fetch(
      await signedRequest(
        context({ ...staffCommand(name), channel_id: config.discord.requestChannelId }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await response.json()).toMatchObject({
      type: 4,
      data: {
        content: "Use this command in the staff channel as the streamer or a volunteer sherpa.",
        flags: 64,
      },
    });
  });

  it("returns independent caller-only statistics snapshots with no controls or pings", async () => {
    const first = await worker.fetch(
      await signedRequest(staffCommand("stats")),
      testEnvironment,
      createExecutionContext(),
    );
    const second = await worker.fetch(
      await signedRequest(
        context({
          ...staffCommand("stats"),
          id: "stats-streamer",
          member: { user: { id: config.discord.streamerUserId, username: "Streamer" }, roles: [] },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    for (const response of [first, second]) {
      expect(await response.json()).toMatchObject({
        type: 4,
        data: {
          flags: 64,
          allowed_mentions: { parse: [] },
          components: [],
          embeds: [{ title: "All-time sherpa statistics" }],
        },
      });
    }
  });

  it("pages users and fills missing Discord and EFT details without notifications", async () => {
    const repo = new D1MvpRepository(env.DB);
    for (let index = 0; index < 12; index += 1) {
      await repo.observeTwitchIdentity({
        twitchLogin: `staff_viewer_${String(index).padStart(2, "0")}`,
        twitchUserId: `staff-twitch-${index}`,
        observedAt: changedAt,
      });
    }
    const command = await worker.fetch(
      await signedRequest(staffCommand("users")),
      testEnvironment,
      createExecutionContext(),
    );
    const commandBody = (await command.json()) as {
      data: { components: Array<{ components: Array<{ custom_id?: string }> }> };
    };
    expect(commandBody).toMatchObject({
      data: { flags: 64, allowed_mentions: { parse: [] }, embeds: [{ title: "Sherpa users" }] },
    });
    const nextId = commandBody.data.components
      .flatMap((row) => row.components)
      .find((component) => component.custom_id?.includes(":next:"))?.custom_id;
    expect(nextId).toBeDefined();
    const next = await worker.fetch(
      await signedRequest(
        staffInsightsInteraction({
          id: "users-next",
          type: 3,
          data: { custom_id: nextId, values: [] },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await next.json()).toMatchObject({ type: 7, data: { allowed_mentions: { parse: [] } } });

    const detail = await worker.fetch(
      await signedRequest(
        staffInsightsInteraction({
          id: "users-detail",
          type: 3,
          data: {
            custom_id: "users:v1:detail:staff_viewer_00",
            values: ["staff_viewer_00"],
          },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await detail.json()).toMatchObject({ type: 7 });

    const addDiscord = await worker.fetch(
      await signedRequest(
        staffInsightsInteraction({
          id: "users-add-discord",
          type: 3,
          data: {
            custom_id: "users:v1:add_discord:staff_viewer_00:staff_viewer_00",
            values: ["selected-member"],
            resolved: {
              users: { "selected-member": { id: "selected-member", username: "Selected" } },
              members: { "selected-member": { roles: [] } },
            },
          },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await addDiscord.json()).toMatchObject({
      type: 7,
      data: { allowed_mentions: { parse: [] } },
    });

    const eftModal = await worker.fetch(
      await signedRequest(
        staffInsightsInteraction({
          id: "users-eft-button",
          type: 3,
          data: {
            custom_id: "users:v1:add_eft:staff_viewer_00:staff_viewer_00",
            values: [],
          },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await eftModal.json()).toMatchObject({ type: 9 });
    const eftResult = await worker.fetch(
      await signedRequest(
        staffInsightsInteraction({
          id: "users-eft-submit",
          type: 5,
          data: {
            custom_id: "users:v1:add_eft:staff_viewer_00:staff_viewer_00",
            components: [
              {
                type: 18,
                component: { type: 4, custom_id: "users:eft-name", value: "Helpful PMC" },
              },
            ],
          },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await eftResult.json()).toMatchObject({
      type: 7,
      data: { allowed_mentions: { parse: [] } },
    });
    expect(await repo.findUserMappingByTwitchLogin("staff_viewer_00")).toMatchObject({
      discordUserId: "selected-member",
      inGameName: "Helpful PMC",
    });
    expect(outbound).toEqual([]);
  });

  it("returns restart guidance for a malformed user-page boundary", async () => {
    const response = await worker.fetch(
      await signedRequest(
        staffInsightsInteraction({
          id: "users-malformed",
          type: 3,
          data: { custom_id: "users:v1:next:BAD-NAME", values: [] },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await response.json()).toMatchObject({
      type: 4,
      data: { content: "Open `/users` again and use a current control.", flags: 64 },
    });
  });

  it("denies a user-directory control outside the staff channel", async () => {
    const response = await worker.fetch(
      await signedRequest(
        staffInsightsInteraction({
          channel_id: config.discord.requestChannelId,
          id: "users-control-wrong-channel",
          type: 3,
          data: { custom_id: "users:v1:next:viewer_001", values: [] },
        }),
      ),
      testEnvironment,
      createExecutionContext(),
    );
    expect(await response.json()).toMatchObject({
      type: 4,
      data: { content: expect.stringContaining("in the staff channel"), flags: 64 },
    });
  });
});
