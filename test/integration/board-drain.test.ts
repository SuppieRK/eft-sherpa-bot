import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { D1MvpRepository } from "../../src/infrastructure/cloudflare/d1-mvp-repository";
import { synchronizeCanonicalBoard } from "../../src/infrastructure/discord/staff-board-handler";
import type { CloudflareEnvironment } from "../../src/infrastructure/cloudflare/environment";
import { testCommunityConfig } from "../fixtures/community";

const now = new Date("2096-08-15T21:00:00.000Z");

afterEach(() => vi.restoreAllMocks());

async function environmentWithBoard(): Promise<CloudflareEnvironment> {
  await env.DB.prepare(
    `INSERT INTO community_state
       (community_id, staff_board_message_id, created_at, updated_at)
     VALUES ('butcoffee', 'canonical-board', ?, ?)`,
  )
    .bind(now.getTime(), now.getTime())
    .run();
  return {
    ...(env as CloudflareEnvironment),
    DISCORD_API_BASE_URL: "https://discord.test/api/v10",
  };
}

it.each([10, 100])("coalesces %i simultaneous board drains", async (count) => {
  const environment = await environmentWithBoard();
  const repository = new D1MvpRepository(env.DB);
  await Promise.all(
    Array.from({ length: count }, (_, index) =>
      repository.markBoardDirty(new Date(now.getTime() + index)),
    ),
  );
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(Response.json({ id: "canonical-board" }));

  await Promise.all(
    Array.from({ length: count }, () =>
      synchronizeCanonicalBoard({
        environment,
        communityConfig: testCommunityConfig,
        changedAt: now,
        createIfMissing: false,
      }),
    ),
  );

  expect(fetchMock).toHaveBeenCalledTimes(1);
  await expect(
    env.DB.prepare(
      `SELECT board_dirty_version AS dirtyVersion,
              board_rendered_version AS renderedVersion,
              board_lease_token AS leaseToken
       FROM community_state WHERE community_id = 'butcoffee'`,
    ).first(),
  ).resolves.toMatchObject({
    dirtyVersion: count,
    renderedVersion: count,
    leaseToken: null,
  });
});

it("keeps failed board work dirty and retries it", async () => {
  const environment = await environmentWithBoard();
  const repository = new D1MvpRepository(env.DB);
  await repository.markBoardDirty(now);
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockRejectedValueOnce(new Error("Discord unavailable"))
    .mockResolvedValueOnce(Response.json({ id: "canonical-board" }));

  await expect(
    synchronizeCanonicalBoard({
      environment,
      communityConfig: testCommunityConfig,
      changedAt: now,
      createIfMissing: false,
    }),
  ).rejects.toThrow("Discord unavailable");
  await expect(
    env.DB.prepare(
      `SELECT board_dirty_version AS dirtyVersion,
              board_rendered_version AS renderedVersion
       FROM community_state WHERE community_id = 'butcoffee'`,
    ).first(),
  ).resolves.toEqual({ dirtyVersion: 1, renderedVersion: 0 });

  await synchronizeCanonicalBoard({
    environment,
    communityConfig: testCommunityConfig,
    changedAt: new Date(now.getTime() + 1),
    createIfMissing: false,
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("drains a newer version that arrives during a Discord update", async () => {
  const environment = await environmentWithBoard();
  const repository = new D1MvpRepository(env.DB);
  await repository.markBoardDirty(now);
  let releaseFirst: (() => void) | undefined;
  const firstStarted = Promise.withResolvers<void>();
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    if (fetchMock.mock.calls.length === 1) {
      firstStarted.resolve();
      await new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });
    }
    return Response.json({ id: "canonical-board" });
  });

  const drain = synchronizeCanonicalBoard({
    environment,
    communityConfig: testCommunityConfig,
    changedAt: now,
    createIfMissing: false,
  });
  await firstStarted.promise;
  await repository.markBoardDirty(new Date(now.getTime() + 1));
  releaseFirst?.();
  await drain;

  expect(fetchMock).toHaveBeenCalledTimes(2);
  await expect(
    env.DB.prepare(
      `SELECT board_dirty_version = board_rendered_version AS current
       FROM community_state WHERE community_id = 'butcoffee'`,
    ).first(),
  ).resolves.toEqual({ current: 1 });
});

it("does not acknowledge a newer version with stale initial board content", async () => {
  const environment = {
    ...(env as CloudflareEnvironment),
    DISCORD_API_BASE_URL: "https://discord.test/api/v10",
  };
  const repository = new D1MvpRepository(env.DB);
  await repository.markBoardDirty(now);
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    if (init?.method === "POST") {
      await repository.markBoardDirty(new Date(now.getTime() + 1));
      return Response.json({ id: "created-board" });
    }
    return Response.json({ id: "created-board" });
  });

  await synchronizeCanonicalBoard({
    environment,
    communityConfig: testCommunityConfig,
    changedAt: now,
    createIfMissing: true,
  });

  expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(["POST", "PATCH"]);
  await expect(
    env.DB.prepare(
      `SELECT staff_board_message_id AS messageId,
              board_dirty_version AS dirtyVersion,
              board_rendered_version AS renderedVersion
       FROM community_state WHERE community_id = 'butcoffee'`,
    ).first(),
  ).resolves.toEqual({ messageId: "created-board", dirtyVersion: 2, renderedVersion: 2 });
});

it("does not acknowledge a newer version with stale 404 replacement content", async () => {
  const environment = await environmentWithBoard();
  const repository = new D1MvpRepository(env.DB);
  await repository.markBoardDirty(now);
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
    if (init?.method === "PATCH" && fetchMock.mock.calls.length === 1) {
      return new Response(null, { status: 404 });
    }
    if (init?.method === "POST") {
      await repository.markBoardDirty(new Date(now.getTime() + 1));
      return Response.json({ id: "replacement-board" });
    }
    return Response.json({ id: "replacement-board" });
  });

  await synchronizeCanonicalBoard({
    environment,
    communityConfig: testCommunityConfig,
    changedAt: now,
    createIfMissing: true,
  });

  expect(fetchMock.mock.calls.map(([, init]) => init?.method)).toEqual(["PATCH", "POST", "PATCH"]);
  await expect(
    env.DB.prepare(
      `SELECT staff_board_message_id AS messageId,
              board_dirty_version AS dirtyVersion,
              board_rendered_version AS renderedVersion
       FROM community_state WHERE community_id = 'butcoffee'`,
    ).first(),
  ).resolves.toEqual({ messageId: "replacement-board", dirtyVersion: 2, renderedVersion: 2 });
});

it("creates one canonical board during concurrent initial synchronization", async () => {
  const environment = {
    ...(env as CloudflareEnvironment),
    DISCORD_API_BASE_URL: "https://discord.test/api/v10",
  };
  const repository = new D1MvpRepository(env.DB);
  await repository.markBoardDirty(now);
  const fetchMock = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation(() => Promise.resolve(Response.json({ id: "only-board" })));

  const results = await Promise.all(
    Array.from({ length: 20 }, () =>
      synchronizeCanonicalBoard({
        environment,
        communityConfig: testCommunityConfig,
        changedAt: now,
        createIfMissing: true,
      }),
    ),
  );

  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(0);
  expect(new Set(results.filter((result) => result !== undefined))).toEqual(
    new Set(["only-board"]),
  );
  await expect(repository.getCanonicalBoardMessageId()).resolves.toBe("only-board");
});

it("allows another drain to reclaim an expired lease", async () => {
  await environmentWithBoard();
  const repository = new D1MvpRepository(env.DB);
  await repository.markBoardDirty(now);

  await expect(
    repository.acquireBoardDrainLease({ token: "first", changedAt: now, createIfMissing: false }),
  ).resolves.toMatchObject({ token: "first", dirtyVersion: 1 });
  await expect(
    repository.acquireBoardDrainLease({
      token: "second",
      changedAt: new Date(now.getTime() + 1_000),
      createIfMissing: false,
    }),
  ).resolves.toBeUndefined();
  await expect(
    repository.acquireBoardDrainLease({
      token: "second",
      changedAt: new Date(now.getTime() + 31_000),
      createIfMissing: false,
    }),
  ).resolves.toMatchObject({ token: "second", dirtyVersion: 1 });
});

it("releases the lease and leaves newer work dirty after three drain attempts", async () => {
  const environment = await environmentWithBoard();
  const repository = new D1MvpRepository(env.DB);
  await repository.markBoardDirty(now);
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    await repository.markBoardDirty(new Date());
    return Response.json({ id: "canonical-board" });
  });

  await synchronizeCanonicalBoard({
    environment,
    communityConfig: testCommunityConfig,
    changedAt: now,
    createIfMissing: false,
  });

  expect(fetchMock).toHaveBeenCalledTimes(3);
  await expect(
    env.DB.prepare(
      `SELECT board_dirty_version AS dirtyVersion,
              board_rendered_version AS renderedVersion,
              board_lease_token AS leaseToken
       FROM community_state WHERE community_id = 'butcoffee'`,
    ).first(),
  ).resolves.toEqual({ dirtyVersion: 4, renderedVersion: 3, leaseToken: null });
});

it("schedules a follow-up drain when three attempts cannot catch up", async () => {
  const environment = await environmentWithBoard();
  const repository = new D1MvpRepository(env.DB);
  await repository.markBoardDirty(now);
  let callCount = 0;
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
    callCount += 1;
    if (callCount <= 3) await repository.markBoardDirty(new Date(now.getTime() + callCount));
    return Response.json({ id: "canonical-board" });
  });
  const context = createExecutionContext();

  await synchronizeCanonicalBoard({
    environment,
    communityConfig: testCommunityConfig,
    changedAt: now,
    createIfMissing: false,
    context,
  });
  await waitOnExecutionContext(context);

  expect(callCount).toBe(4);
  await expect(
    env.DB.prepare(
      `SELECT board_dirty_version = board_rendered_version AS current,
              board_lease_token AS leaseToken
       FROM community_state WHERE community_id = 'butcoffee'`,
    ).first(),
  ).resolves.toEqual({ current: 1, leaseToken: null });
});
