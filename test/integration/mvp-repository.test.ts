import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { TARKOV_MAPS } from "../../src/domain/maps/catalog";
import type { GameMode } from "../../src/domain/game-mode";
import type { StaffBoardRaid } from "../../src/domain/staff-board";
import { D1Metrics, instrumentD1Database } from "../../src/infrastructure/cloudflare/d1-metrics";
import { D1MvpRepository } from "../../src/infrastructure/cloudflare/d1-mvp-repository";

const now = new Date("2096-08-15T21:00:00.000Z");

function repository(): D1MvpRepository {
  return new D1MvpRepository(env.DB);
}

async function ensureCommunityState(): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO community_state (community_id, created_at, updated_at)
     VALUES ('butcoffee', 0, 0)`,
  ).run();
}

async function createRequest(
  repo: D1MvpRepository,
  index: number,
  mapId = "customs",
  gameMode: GameMode = "pve",
  recipientLimit = 3,
): Promise<number> {
  const created = await repo.createRequest({
    sourcePlatform: "twitch",
    sourceDeliveryId: `delivery-${index}`,
    twitchUserId: `twitch-${index}`,
    twitchLogin: `viewer_${index}`,
    gameMode,
    inGameName: `PMC ${index}`,
    mapId,
    objective: `Goal ${index}`,
    recipientLimit,
    observedAt: new Date(now.getTime() + index),
  });
  return created.request.id;
}

async function seedWaitingRequests(
  count: number,
  input: {
    offset?: number;
    gameMode?: (index: number) => number;
    isPriority?: (index: number) => number;
  } = {},
): Promise<void> {
  const offset = input.offset ?? 0;
  for (let start = 1; start <= count; start += 1_000) {
    const end = Math.min(count, start + 999);
    const rows = Array.from({ length: end - start + 1 }, (_, rowOffset) => {
      const index = offset + start + rowOffset;
      return {
        index,
        gameMode: input.gameMode?.(index) ?? 2,
        isPriority: input.isPriority?.(index) ?? 0,
      };
    });
    // Test fixtures are inserted in bounded chunks so the recovery path, not setup, is measured.
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user_mappings
           (twitch_login, twitch_user_id, in_game_name, created_at, updated_at)
         SELECT printf('bulk_viewer_%d', json_extract(value, '$.index')),
                printf('bulk-twitch-%d', json_extract(value, '$.index')),
                printf('Bulk PMC %d', json_extract(value, '$.index')), ?, ?
         FROM json_each(?)`,
      ).bind(now.getTime(), now.getTime(), JSON.stringify(rows)),
      env.DB.prepare(
        `INSERT INTO help_requests
         (source_platform, source_delivery_id, twitch_user_id, twitch_login, in_game_name,
          game_mode, map_id, objective, is_priority, state, created_at, updated_at)
       SELECT 1, printf('bulk-delivery-%d', json_extract(value, '$.index')),
              printf('bulk-twitch-%d', json_extract(value, '$.index')),
              printf('bulk_viewer_%d', json_extract(value, '$.index')),
              printf('Bulk PMC %d', json_extract(value, '$.index')),
              json_extract(value, '$.gameMode'), 'customs',
              printf('Bulk goal %d', json_extract(value, '$.index')),
              json_extract(value, '$.isPriority'), 0, ?, ?
         FROM json_each(?)`,
      ).bind(now.getTime(), now.getTime(), JSON.stringify(rows)),
    ]);
  }
}

async function currentMemberCount(groupId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT current_member_count AS count FROM raid_groups WHERE id = ?`,
  )
    .bind(groupId)
    .first<{ count: number }>();
  return Number(row?.count ?? -1);
}

async function start(repo: D1MvpRepository, raid: StaffBoardRaid): Promise<StaffBoardRaid> {
  await review(repo, raid);
  return repo.startRaid({
    groupId: raid.id,
    leaderDiscordUserId: "leader",
    leaderType: "volunteer",
    requestTwitchCall: false,
    changedAt: now,
  });
}

async function review(
  repo: D1MvpRepository,
  raid: StaffBoardRaid,
  messageId = `review-${raid.id}`,
): Promise<StaffBoardRaid> {
  await repo.reviewRaid({ groupId: raid.id, changedAt: now });
  await repo.compareAndSetRaidStaffMessage({
    groupId: raid.id,
    messageId,
    changedAt: now,
  });
  return (await repo.getRaid(raid.id)) as StaffBoardRaid;
}

async function postpone(
  repo: D1MvpRepository,
  raid: StaffBoardRaid,
  suffix: string,
): Promise<void> {
  await start(repo, raid);
  await repo.postponeRaid({ groupId: raid.id, actionKey: suffix, changedAt: now });
}

describe("schedule-independent dual queues", () => {
  it("commits every new request as planned with one open membership", async () => {
    const repo = repository();
    const result = await repo.createRequest({
      sourcePlatform: "twitch",
      sourceDeliveryId: "atomic-request",
      twitchUserId: "atomic-twitch",
      twitchLogin: "atomic_viewer",
      gameMode: "pve",
      inGameName: "Atomic PMC",
      mapId: "customs",
      objective: "Atomic task",
      recipientLimit: 4,
      observedAt: now,
    });

    expect(result).toMatchObject({ outcome: "created", queueChanged: true });
    expect(result.request.state).toBe("planned");
    await expect(
      env.DB.prepare(
        `SELECT request.state, count(member.id) AS memberships
         FROM help_requests AS request
         LEFT JOIN raid_group_members AS member
           ON member.request_id = request.id AND member.state = 0
         WHERE request.id = ? GROUP BY request.id`,
      )
        .bind(result.request.id)
        .first(),
    ).resolves.toEqual({ state: 1, memberships: 1 });
  });

  it("rolls back identity, request, raid, and membership when assignment fails", async () => {
    const repo = repository();
    await env.DB.prepare(
      `CREATE TRIGGER test_atomic_assignment_failure
       BEFORE INSERT ON raid_group_members
       BEGIN
         SELECT RAISE(ABORT, 'injected assignment failure');
       END;`,
    ).run();
    try {
      await expect(
        repo.createRequest({
          sourcePlatform: "twitch",
          sourceDeliveryId: "atomic-failure",
          twitchUserId: "atomic-failure-twitch",
          twitchLogin: "atomic_failure",
          gameMode: "pve",
          inGameName: "Atomic Failure PMC",
          mapId: "customs",
          objective: "Fail atomically",
          recipientLimit: 4,
          observedAt: now,
        }),
      ).rejects.toThrow();
    } finally {
      await env.DB.prepare(`DROP TRIGGER test_atomic_assignment_failure`).run();
    }
    await expect(
      env.DB.prepare(
        `SELECT
           (SELECT count(*) FROM user_mappings WHERE twitch_login = 'atomic_failure') AS mappings,
           (SELECT count(*) FROM help_requests WHERE source_delivery_id = 'atomic-failure') AS requests,
           (SELECT count(*) FROM raid_groups) AS raids,
           (SELECT count(*) FROM raid_group_members) AS memberships`,
      ).first(),
    ).resolves.toEqual({ mappings: 0, requests: 0, raids: 0, memberships: 0 });
  });

  it("serializes concurrent intake into exact-capacity raids with contiguous positions", async () => {
    const repo = repository();
    const results = await Promise.all(
      Array.from({ length: 9 }, (_, offset) =>
        repo.createRequest({
          sourcePlatform: "twitch",
          sourceDeliveryId: `atomic-concurrent-${offset}`,
          twitchUserId: `atomic-concurrent-twitch-${offset}`,
          twitchLogin: `atomic_concurrent_${offset}`,
          gameMode: "pve",
          inGameName: `Atomic PMC ${offset}`,
          mapId: "customs",
          objective: `Concurrent task ${offset}`,
          recipientLimit: 4,
          observedAt: new Date(now.getTime() + offset),
        }),
      ),
    );
    expect(results.every((result) => result.request.state === "planned")).toBe(true);
    const groups = await env.DB.prepare(
      `SELECT raid.current_member_count AS memberCount,
              min(member.position) AS firstPosition,
              max(member.position) AS lastPosition,
              count(DISTINCT member.position) AS uniquePositions
       FROM raid_groups AS raid
       JOIN raid_group_members AS member ON member.group_id = raid.id AND member.state = 0
       GROUP BY raid.id ORDER BY raid.sort_key`,
    ).all<{
      memberCount: number;
      firstPosition: number;
      lastPosition: number;
      uniquePositions: number;
    }>();
    expect(groups.results).toEqual([
      { memberCount: 4, firstPosition: 1, lastPosition: 4, uniquePositions: 4 },
      { memberCount: 4, firstPosition: 1, lastPosition: 4, uniquePositions: 4 },
      { memberCount: 1, firstPosition: 1, lastPosition: 1, uniquePositions: 1 },
    ]);
  });

  it("appends normal intake after the highest active position when a gap exists", async () => {
    const repo = repository();
    const removedRequestId = await createRequest(repo, 1, "customs", "pve", 4);
    await createRequest(repo, 2, "customs", "pve", 4);
    await createRequest(repo, 3, "customs", "pve", 4);
    const raid = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE raid_group_members SET state = 2, updated_at = ?
         WHERE group_id = ? AND request_id = ? AND state = 0`,
      ).bind(now.getTime(), raid.id, removedRequestId),
      env.DB.prepare(`UPDATE help_requests SET state = 3, updated_at = ? WHERE id = ?`).bind(
        now.getTime(),
        removedRequestId,
      ),
    ]);

    const appendedRequestId = await createRequest(repo, 4, "customs", "pve", 4);

    await expect(
      env.DB.prepare(
        `SELECT position FROM raid_group_members
         WHERE group_id = ? AND request_id = ? AND state = 0`,
      )
        .bind(raid.id, appendedRequestId)
        .first(),
    ).resolves.toEqual({ position: 4 });
  });

  it("commits one board dirty version with a new intake membership", async () => {
    const repo = repository();
    const input = {
      sourcePlatform: "twitch" as const,
      sourceDeliveryId: "atomic-board-dirty",
      twitchUserId: "atomic-board-dirty-user",
      twitchLogin: "atomic_board_dirty",
      gameMode: "pve" as const,
      inGameName: "Atomic Dirty PMC",
      mapId: "customs",
      objective: "Mark the board in the intake batch",
      recipientLimit: 4,
      observedAt: now,
    };

    await expect(repo.createRequest(input)).resolves.toMatchObject({
      outcome: "created",
      queueChanged: true,
    });
    await expect(
      env.DB.prepare(
        "SELECT board_dirty_version AS dirtyVersion FROM community_state WHERE community_id = 'butcoffee'",
      ).first(),
    ).resolves.toEqual({ dirtyVersion: 1 });

    await expect(repo.createRequest(input)).resolves.toMatchObject({
      outcome: "duplicate_delivery",
      queueChanged: false,
    });
    await expect(
      env.DB.prepare(
        "SELECT board_dirty_version AS dirtyVersion FROM community_state WHERE community_id = 'butcoffee'",
      ).first(),
    ).resolves.toEqual({ dirtyVersion: 1 });
  });

  it("assigns requests without schedule data and bounds ordinary display at seven", async () => {
    const repo = repository();
    for (let index = 1; index <= 25; index += 1) await createRequest(repo, index);

    const board = await repo.getBoardSnapshot();
    expect(board).toMatchObject({
      ordinaryRaidCount: 9,
      priorityRaidCount: 0,
    });
    expect(board.ordinaryRaids).toHaveLength(7);
    expect(board.ordinaryRaids.map((raid) => raid.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    await expect(
      Promise.all(board.ordinaryRaids.map((raid) => currentMemberCount(raid.id))),
    ).resolves.toEqual(board.ordinaryRaids.map((raid) => raid.members.length));
    expect(board.priorityRaids).toEqual([]);
  });

  it("groups only requests with the same game mode and map", async () => {
    const repo = repository();
    for (let index = 1; index <= 4; index += 1) {
      await createRequest(repo, index, "customs", "pve");
    }
    await createRequest(repo, 5, "customs", "pvp");
    await createRequest(repo, 6, "customs", "pvp-seasonal");

    const raids = await env.DB.prepare(
      `SELECT raid.game_mode AS gameMode, count(member.id) AS members
       FROM raid_groups AS raid
       JOIN raid_group_members AS member ON member.group_id = raid.id AND member.state = 0
       GROUP BY raid.id ORDER BY raid.sort_key`,
    ).all<{ gameMode: number; members: number }>();
    expect(raids.results).toEqual([
      { gameMode: 2, members: 3 },
      { gameMode: 2, members: 1 },
      { gameMode: 1, members: 1 },
      { gameMode: 0, members: 1 },
    ]);
  });

  it("reserves a visible raid for every non-empty mode under skew", async () => {
    const repo = repository();
    for (let index = 1; index <= 21; index += 1) {
      await createRequest(repo, index, "customs", "pve");
    }
    await createRequest(repo, 22, "customs", "pvp");
    await createRequest(repo, 23, "customs", "pvp-seasonal");

    const board = await repo.getBoardSnapshot();
    expect(board.ordinaryRaidCount).toBe(9);
    expect(board.ordinaryRaids).toHaveLength(7);
    expect(board.ordinaryRaids.slice(0, 3).map((raid) => raid.gameMode)).toEqual([
      "pve",
      "pvp",
      "pvp-seasonal",
    ]);
    expect(board.ordinaryRaids.filter((raid) => raid.gameMode === "pve")).toHaveLength(5);
  });

  it("reserves a minority-mode raid and keeps dominant-mode FIFO order", async () => {
    const repo = repository();
    for (let index = 1; index <= 21; index += 1) {
      await createRequest(repo, index, "customs", "pve");
    }
    await createRequest(repo, 22, "customs", "pvp");

    const board = await repo.getBoardSnapshot();
    expect(board.ordinaryRaids.map((raid) => raid.gameMode)).toEqual([
      "pve",
      "pvp",
      "pve",
      "pve",
      "pve",
      "pve",
      "pve",
    ]);
    expect(
      board.ordinaryRaids.filter((raid) => raid.gameMode === "pve").map((raid) => raid.id),
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("applies mode-presence ordering independently to Priority raids", async () => {
    const repo = repository();
    for (let index = 1; index <= 21; index += 1) {
      await createRequest(repo, index, "customs", "pve");
    }
    await createRequest(repo, 22, "customs", "pvp");
    await createRequest(repo, 23, "customs", "pvp-seasonal");
    const ordinary = (await repo.getBoardSnapshot()).ordinaryRaids;
    for (const [index, mode] of (["pve", "pvp", "pvp-seasonal"] as const).entries()) {
      const raid = ordinary.find((candidate) => candidate.gameMode === mode);
      expect(raid).toBeDefined();
      await postpone(repo, raid as StaffBoardRaid, `priority-mode-${index}`);
    }

    const board = await repo.getBoardSnapshot();
    expect(board.priorityRaidCount).toBe(3);
    expect(board.priorityRaids.map((raid) => raid.gameMode)).toEqual([
      "pve",
      "pvp",
      "pvp-seasonal",
    ]);
    expect(board.ordinaryRaids[0]?.gameMode).toBe("pve");
  });

  it("allows the same viewer to request one map in different modes", async () => {
    const repo = repository();
    const base = {
      sourcePlatform: "twitch" as const,
      twitchUserId: "same-viewer-id",
      twitchLogin: "same_viewer",
      inGameName: "Same PMC",
      mapId: "customs",
      objective: "Task",
      recipientLimit: 3,
      observedAt: now,
    };
    await expect(
      repo.createRequest({ ...base, sourceDeliveryId: "same-pve", gameMode: "pve" }),
    ).resolves.toMatchObject({ outcome: "created" });
    await expect(
      repo.createRequest({ ...base, sourceDeliveryId: "same-pvp", gameMode: "pvp" }),
    ).resolves.toMatchObject({ outcome: "created" });
    await expect(
      repo.createRequest({ ...base, sourceDeliveryId: "same-pve-again", gameMode: "pve" }),
    ).resolves.toMatchObject({ outcome: "already_active" });
  });

  it.each(["active", "reserved"] as const)(
    "appends after an %s raid that cannot accept automatic members",
    async (existingState) => {
      const repo = repository();
      await createRequest(repo, 1);
      const existing = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
      if (existingState === "active") {
        await start(repo, existing);
      } else {
        await env.DB.prepare(`UPDATE raid_groups SET automatic_fill = 0 WHERE id = ?`)
          .bind(existing.id)
          .run();
      }

      await createRequest(repo, 2);
      const groups = await env.DB.prepare(
        `SELECT sort_key AS sortKey FROM raid_groups WHERE state IN (0, 1) ORDER BY sort_key`,
      ).all<{ sortKey: number }>();
      expect(groups.results).toEqual([{ sortKey: 1_000_000 }, { sortKey: 2_000_000 }]);
    },
  );

  it("always leaves one map-specific party place for the sherpa", async () => {
    const repo = repository();
    let requestIndex = 1;
    for (const map of TARKOV_MAPS) {
      for (let index = 0; index < map.sherpaPartyCapacity; index += 1) {
        await createRequest(repo, requestIndex, map.id, "pve", 99);
        requestIndex += 1;
      }
    }
    for (const map of TARKOV_MAPS) {
      const raids = await env.DB.prepare(
        `SELECT id, requester_capacity AS requesterCapacity, current_member_count AS memberCount
         FROM raid_groups WHERE map_id = ? ORDER BY sort_key`,
      )
        .bind(map.id)
        .all<{ id: number; requesterCapacity: number; memberCount: number }>();
      const requesterCapacity = map.sherpaPartyCapacity - 1;
      expect(raids.results).toEqual([
        expect.objectContaining({ requesterCapacity, memberCount: requesterCapacity }),
        expect.objectContaining({ requesterCapacity, memberCount: 1 }),
      ]);

      const [fullRaid, overflowRaid] = raids.results;
      const overflowMember = await env.DB.prepare(
        `SELECT id FROM raid_group_members WHERE group_id = ? AND state = 0`,
      )
        .bind(overflowRaid?.id)
        .first<{ id: number }>();
      await expect(
        env.DB.prepare(
          `UPDATE raid_group_members SET group_id = ?, position = ?
           WHERE id = ? AND state = 0`,
        )
          .bind(fullRaid?.id, map.sherpaPartyCapacity, overflowMember?.id)
          .run(),
      ).rejects.toThrow("raid group capacity exceeded");
      await expect(currentMemberCount(fullRaid?.id as number)).resolves.toBe(requesterCapacity);
      await expect(currentMemberCount(overflowRaid?.id as number)).resolves.toBe(1);
    }
  });

  it("shows independent three-priority and seven-ordinary windows with complete raid totals", async () => {
    const repo = repository();
    for (let index = 1; index <= 12; index += 1) await createRequest(repo, index);
    const sources = (await repo.getBoardSnapshot()).ordinaryRaids.slice(0, 4);
    for (const [index, raid] of sources.entries()) await postpone(repo, raid, `source-${index}`);
    for (let index = 13; index <= 36; index += 1) await createRequest(repo, index);

    const board = await repo.getBoardSnapshot();
    expect(board).toMatchObject({
      priorityRaidCount: 4,
      ordinaryRaidCount: 8,
    });
    expect(board.priorityRaids).toHaveLength(3);
    expect(board.ordinaryRaids).toHaveLength(7);
  });

  it("returns the authenticated caller's mode-scoped position", async () => {
    const repo = repository();
    for (let index = 1; index <= 4; index += 1) await createRequest(repo, index);
    await expect(
      repo.getQueueFacts({ platform: "twitch", userId: "twitch-4" }),
    ).resolves.toMatchObject({
      caller: {
        mapName: "Customs",
        queuePosition: { kind: "exact", ordinal: 4 },
        raidsAhead: { kind: "exact", count: 1 },
      },
    });
  });

  it("does not count another mode in the request ordinal but includes its fair raid head", async () => {
    const repo = repository();
    for (let index = 1; index <= 6; index += 1) {
      await createRequest(repo, index, "customs", "pve");
    }
    await createRequest(repo, 7, "customs", "pvp");

    await expect(
      repo.getQueueFacts({ platform: "twitch", userId: "twitch-7" }),
    ).resolves.toMatchObject({
      caller: {
        gameMode: "pvp",
        mapName: "Customs",
        queuePosition: { kind: "exact", ordinal: 1 },
        raidsAhead: { kind: "exact", count: 1 },
      },
    });
  });

  it("counts priority raids ahead of an ordinary caller", async () => {
    const repo = repository();
    for (let index = 1; index <= 3; index += 1) await createRequest(repo, index);
    await postpone(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
      "priority",
    );
    await createRequest(repo, 4);

    await expect(
      repo.getQueueFacts({ platform: "twitch", userId: "twitch-4" }),
    ).resolves.toMatchObject({
      caller: {
        queuePosition: { kind: "exact", ordinal: 4 },
        raidsAhead: { kind: "exact", count: 1 },
      },
    });
  });

  it("requests a Twitch call for a streamer-led raid without schedule state", async () => {
    const repo = repository();
    await createRequest(repo, 1);
    const raid = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    await repo.reviewRaid({ groupId: raid.id, changedAt: now });
    await repo.compareAndSetRaidStaffMessage({
      groupId: raid.id,
      messageId: `review-${raid.id}`,
      changedAt: now,
    });
    const started = await repo.startRaid({
      groupId: raid.id,
      leaderDiscordUserId: "streamer",
      leaderType: "streamer",
      requestTwitchCall: true,
      canOverrideReservedLeader: true,
      changedAt: now,
    });
    expect(started).toMatchObject({
      state: "active",
      discordCallStatus: "pending",
      twitchCallStatus: "pending",
    });
  });

  it("freezes a reviewed party before later compatible requests are assigned", async () => {
    const repo = repository();
    const first = await createRequest(repo, 1);
    const second = await createRequest(repo, 2);
    const planned = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;

    const reviewed = await review(repo, planned, "frozen-review");
    expect(reviewed).toMatchObject({
      state: "planned",
      automaticFill: false,
      attemptCount: 0,
      discordCallStatus: "not_requested",
      twitchCallStatus: "not_requested",
      staffMessageId: "frozen-review",
    });
    expect(reviewed.leaderDiscordUserId).toBeUndefined();

    const later = await createRequest(repo, 3);
    const board = await repo.getBoardSnapshot();
    expect((await repo.getRaid(reviewed.id))?.members.map((member) => member.requestId)).toEqual([
      first,
      second,
    ]);
    const laterRaid = board.ordinaryRaids.find((raid) => raid.id !== reviewed.id);
    expect(laterRaid?.members.map((member) => member.requestId)).toEqual([later]);
  });

  it("dismisses only the matching planned review and cannot clear active details", async () => {
    const repo = repository();
    const requestId = await createRequest(repo, 1);
    const planned = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    const reviewed = await review(repo, planned, "dismiss-review");

    await expect(
      repo.dismissRaidReview({
        groupId: reviewed.id,
        expectedMessageId: "stale-review",
        changedAt: now,
      }),
    ).resolves.toBe(false);
    await expect(
      repo.dismissRaidReview({
        groupId: reviewed.id,
        expectedMessageId: "dismiss-review",
        changedAt: now,
      }),
    ).resolves.toBe(true);
    expect(await repo.getRaid(reviewed.id)).toMatchObject({
      state: "planned",
      automaticFill: false,
      attemptCount: 0,
      members: [expect.objectContaining({ requestId })],
    });
    expect((await repo.getRaid(reviewed.id))?.staffMessageId).toBeUndefined();

    await repo.compareAndSetRaidStaffMessage({
      groupId: reviewed.id,
      messageId: "active-review",
      changedAt: now,
    });
    await repo.startRaid({
      groupId: reviewed.id,
      leaderDiscordUserId: "leader",
      leaderType: "volunteer",
      requestTwitchCall: false,
      changedAt: now,
    });
    await expect(
      repo.dismissRaidReview({
        groupId: reviewed.id,
        expectedMessageId: "active-review",
        changedAt: now,
      }),
    ).resolves.toBe(false);
    expect(await repo.getRaid(reviewed.id)).toMatchObject({
      state: "active",
      staffMessageId: "active-review",
      members: [expect.objectContaining({ requestId })],
    });
  });

  it("serializes review dismissal against raid start", async () => {
    const repo = repository();
    await createRequest(repo, 1);
    const planned = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    const reviewed = await review(repo, planned, "dismiss-or-start");

    const [dismissed, started] = await Promise.allSettled([
      repo.dismissRaidReview({
        groupId: reviewed.id,
        expectedMessageId: "dismiss-or-start",
        changedAt: now,
      }),
      repo.startRaid({
        groupId: reviewed.id,
        leaderDiscordUserId: "leader",
        leaderType: "volunteer",
        requestTwitchCall: false,
        changedAt: now,
      }),
    ]);
    const current = (await repo.getRaid(reviewed.id)) as StaffBoardRaid;
    if (started.status === "fulfilled") {
      expect(dismissed).toEqual({ status: "fulfilled", value: false });
      expect(current).toMatchObject({ state: "active", staffMessageId: "dismiss-or-start" });
    } else {
      expect(dismissed).toEqual({ status: "fulfilled", value: true });
      expect(current).toMatchObject({ state: "planned", automaticFill: false });
      expect(current.staffMessageId).toBeUndefined();
    }
  });

  it("allows exactly one concurrent caller to activate a reviewed raid", async () => {
    const repo = repository();
    await createRequest(repo, 1);
    const planned = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    await review(repo, planned, "concurrent-start-review");

    const starts = await Promise.allSettled(
      ["first-volunteer", "second-volunteer"].map((leaderDiscordUserId) =>
        repo.startRaid({
          groupId: planned.id,
          leaderDiscordUserId,
          leaderType: "volunteer",
          requestTwitchCall: false,
          changedAt: now,
        }),
      ),
    );
    expect(starts.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(starts.filter((result) => result.status === "rejected")).toHaveLength(1);
    const active = await repo.getRaid(planned.id);
    expect(active).toMatchObject({
      state: "active",
      attemptCount: 1,
      discordCallStatus: "pending",
      twitchCallStatus: "not_requested",
      staffMessageId: "concurrent-start-review",
    });
    expect(["first-volunteer", "second-volunteer"]).toContain(active?.leaderDiscordUserId);
  });

  it("keeps reserved follow-up activation restricted to its leader or the streamer", async () => {
    const repo = repository();
    await createRequest(repo, 1);
    const source = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );
    const postponed = await repo.postponeRaid({
      groupId: source.id,
      actionKey: "reserve-follow-up",
      changedAt: now,
    });
    await review(repo, postponed, "reserved-review");

    await expect(
      repo.startRaid({
        groupId: postponed.id,
        leaderDiscordUserId: "other-volunteer",
        leaderType: "volunteer",
        requestTwitchCall: false,
        changedAt: now,
      }),
    ).rejects.toThrow("no longer available to start");
    await expect(
      repo.startRaid({
        groupId: postponed.id,
        leaderDiscordUserId: "streamer",
        leaderType: "streamer",
        requestTwitchCall: true,
        canOverrideReservedLeader: true,
        changedAt: now,
      }),
    ).resolves.toMatchObject({
      state: "active",
      leaderDiscordUserId: "streamer",
      twitchCallStatus: "pending",
    });
  });

  it("moves and removes requesters from a frozen review without starting it", async () => {
    const repo = repository();
    const retained = await createRequest(repo, 1);
    const moved = await createRequest(repo, 2);
    const removed = await createRequest(repo, 3);
    const planned = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    await review(repo, planned, "editable-review");

    const movement = await repo.postponeRequester({
      groupId: planned.id,
      requestId: moved,
      actionKey: "move-before-call",
      changedAt: now,
    });
    expect(movement.source).toMatchObject({
      state: "planned",
      automaticFill: false,
      attemptCount: 0,
      discordCallStatus: "not_requested",
      twitchCallStatus: "not_requested",
      staffMessageId: "editable-review",
    });
    expect(movement.dedicated.members.map((member) => member.requestId)).toEqual([moved]);

    const afterRemoval = await repo.removeRequester({
      groupId: planned.id,
      requestId: removed,
      actionKey: "remove-before-call",
      changedAt: now,
    });
    expect(afterRemoval).toMatchObject({ state: "planned", automaticFill: false });
    expect(afterRemoval.members.map((member) => member.requestId)).toEqual([retained]);
    const removedRequest = await env.DB.prepare("SELECT state FROM help_requests WHERE id = ?")
      .bind(removed)
      .first<{ state: number }>();
    expect(removedRequest?.state).toBe(3);

    const closed = await repo.removeRequester({
      groupId: planned.id,
      requestId: retained,
      actionKey: "remove-last-before-call",
      changedAt: now,
    });
    expect(closed).toMatchObject({ state: "canceled", outcome: "not_run" });
    expect(closed.staffMessageId).toBeUndefined();
  });

  it("starts at any time and advances attempts before completing helped requests", async () => {
    const repo = repository();
    await createRequest(repo, 1);
    const raid = (await repo.getBoardSnapshot()).ordinaryRaids[0];
    expect(raid).toBeDefined();
    const started = await start(repo, raid as StaffBoardRaid);
    expect(started).toMatchObject({
      state: "active",
      queueKind: "ordinary",
      attemptCount: 1,
      leaderDiscordUserId: "leader",
      discordCallStatus: "pending",
      twitchCallStatus: "not_requested",
    });
    const second = await repo.recordRaidResult({
      groupId: started.id,
      outcome: "unsuccessful",
      attemptLimit: 3,
      actionKey: "attempt-two",
      changedAt: now,
    });
    expect(second.attemptCount).toBe(2);
    const helped = await repo.recordRaidResult({
      groupId: started.id,
      outcome: "helped",
      attemptLimit: 3,
      actionKey: "helped",
      changedAt: now,
    });
    expect(helped).toMatchObject({ state: "completed", outcome: "helped" });
    await expect(currentMemberCount(started.id)).resolves.toBe(0);
  });

  it("does not complete a requester that was postponed out of a helped raid", async () => {
    const repo = repository();
    const firstRequest = await createRequest(repo, 1);
    const postponedRequest = await createRequest(repo, 2);
    const source = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );
    const moved = await repo.postponeRequester({
      groupId: source.id,
      requestId: postponedRequest,
      actionKey: "move-before-helped",
      changedAt: now,
    });
    await repo.recordRaidResult({
      groupId: source.id,
      outcome: "helped",
      attemptLimit: 3,
      actionKey: "help-source-only",
      changedAt: now,
    });

    const states = await env.DB.prepare(
      `SELECT id, state FROM help_requests WHERE id IN (?, ?) ORDER BY id`,
    )
      .bind(firstRequest, postponedRequest)
      .all<{ id: number; state: number }>();
    expect(states.results).toEqual([
      { id: firstRequest, state: 2 },
      { id: postponedRequest, state: 1 },
    ]);
    expect((await repo.getRaid(moved.dedicated.id))?.members).toHaveLength(1);
    await expect(currentMemberCount(source.id)).resolves.toBe(0);
    await expect(currentMemberCount(moved.dedicated.id)).resolves.toBe(1);
  });

  it("uses Postpone raid as the only unresolved result after the final attempt", async () => {
    const repo = repository();
    for (let index = 1; index <= 3; index += 1) await createRequest(repo, index);
    const source = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );
    for (const attempt of [2, 3]) {
      await repo.recordRaidResult({
        groupId: source.id,
        outcome: "unsuccessful",
        attemptLimit: 3,
        actionKey: `final-attempt-${attempt}`,
        changedAt: now,
      });
    }
    await expect(
      repo.recordRaidResult({
        groupId: source.id,
        outcome: "unsuccessful",
        attemptLimit: 3,
        actionKey: "extra-unsuccessful",
        changedAt: now,
      }),
    ).rejects.toThrow("Choose Helped or Postpone raid");

    const postponed = await repo.postponeRaid({
      groupId: source.id,
      actionKey: "final-postpone",
      changedAt: now,
    });
    expect(postponed).toMatchObject({
      id: source.id,
      queueKind: "priority",
      state: "planned",
      attemptCount: 0,
      leaderDiscordUserId: "leader",
    });
    expect(postponed.members.map((member) => member.requestId)).toEqual(
      source.members.map((member) => member.requestId),
    );
    const groupCount = await env.DB.prepare(`SELECT count(*) AS count FROM raid_groups`).first<{
      count: number;
    }>();
    expect(groupCount?.count).toBe(1);
  });

  it("postpones a requester into a fillable raid immediately after the source", async () => {
    const repo = repository();
    const firstRequest = await createRequest(repo, 1);
    const secondRequest = await createRequest(repo, 2);
    const raid = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    await start(repo, raid);
    const result = await repo.postponeRequester({
      groupId: raid.id,
      requestId: secondRequest,
      actionKey: "postpone",
      changedAt: now,
    });
    expect(result.source.members.map((member) => member.requestId)).toEqual([firstRequest]);
    expect(result.dedicated).toMatchObject({
      queueKind: "ordinary",
      automaticFill: true,
      attemptCount: 0,
      leaderDiscordUserId: "leader",
    });
    expect((await repo.getBoardSnapshot()).ordinaryRaids.map((group) => group.id)).toEqual([
      raid.id,
      result.dedicated.id,
    ]);
    await expect(currentMemberCount(raid.id)).resolves.toBe(1);
    await expect(currentMemberCount(result.dedicated.id)).resolves.toBe(1);
  });

  it("fills the only requester's follow-up with a later same-map request", async () => {
    const repo = repository();
    const postponedRequest = await createRequest(repo, 1, "interchange");
    const source = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );
    const postponed = await repo.postponeRequester({
      groupId: source.id,
      requestId: postponedRequest,
      actionKey: "postpone-only-requester",
      changedAt: now,
    });

    const laterRequest = await createRequest(repo, 2, "interchange");

    const board = await repo.getBoardSnapshot();
    expect(board.ordinaryRaidCount).toBe(1);
    expect(board.ordinaryRaids[0]).toMatchObject({
      id: postponed.dedicated.id,
      automaticFill: true,
    });
    expect(board.ordinaryRaids[0]?.members.map((member) => member.requestId)).toEqual([
      postponedRequest,
      laterRequest,
    ]);
  });

  it("fills requester follow-ups only with the same game mode", async () => {
    const repo = repository();
    const postponedRequest = await createRequest(repo, 1, "interchange", "pve");
    const source = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );
    const postponed = await repo.postponeRequester({
      groupId: source.id,
      requestId: postponedRequest,
      actionKey: "postpone-mode-safe",
      changedAt: now,
    });

    const pvpRequest = await createRequest(repo, 2, "interchange", "pvp");
    const pveRequest = await createRequest(repo, 3, "interchange", "pve");

    const followUp = await repo.getRaid(postponed.dedicated.id);
    expect(followUp?.gameMode).toBe("pve");
    expect(followUp?.members.map((member) => member.requestId)).toEqual([
      postponedRequest,
      pveRequest,
    ]);
    const pvpRaid = (await repo.getBoardSnapshot()).ordinaryRaids.find(
      (raid) => raid.gameMode === "pvp",
    );
    expect(pvpRaid?.members.map((member) => member.requestId)).toEqual([pvpRequest]);
  });

  it("reuses one follow-up for requesters postponed from the same source", async () => {
    const repo = repository();
    const retainedRequest = await createRequest(repo, 1);
    const firstPostponedRequest = await createRequest(repo, 2);
    const secondPostponedRequest = await createRequest(repo, 3);
    const source = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );

    const first = await repo.postponeRequester({
      groupId: source.id,
      requestId: firstPostponedRequest,
      actionKey: "postpone-first-of-two",
      changedAt: now,
    });
    const second = await repo.postponeRequester({
      groupId: source.id,
      requestId: secondPostponedRequest,
      actionKey: "postpone-second-of-two",
      changedAt: now,
    });

    expect(second.dedicated.id).toBe(first.dedicated.id);
    expect(second.source.members.map((member) => member.requestId)).toEqual([retainedRequest]);
    expect(second.dedicated.members.map((member) => member.requestId)).toEqual([
      firstPostponedRequest,
      secondPostponedRequest,
    ]);
    expect((await repo.getBoardSnapshot()).ordinaryRaidCount).toBe(2);
  });

  it("appends a postponed requester after the highest active follow-up position", async () => {
    const repo = repository();
    const retainedRequest = await createRequest(repo, 1, "customs", "pve", 4);
    const removedRequest = await createRequest(repo, 2, "customs", "pve", 4);
    const existingRequest = await createRequest(repo, 3, "customs", "pve", 4);
    const appendedRequest = await createRequest(repo, 4, "customs", "pve", 4);
    const source = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );
    const first = await repo.postponeRequester({
      groupId: source.id,
      requestId: removedRequest,
      actionKey: "postpone-gap-first",
      changedAt: now,
    });
    await repo.postponeRequester({
      groupId: source.id,
      requestId: existingRequest,
      actionKey: "postpone-gap-second",
      changedAt: now,
    });
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE raid_group_members SET state = 2, updated_at = ?
         WHERE group_id = ? AND request_id = ? AND state = 0`,
      ).bind(now.getTime(), first.dedicated.id, removedRequest),
      env.DB.prepare(`UPDATE help_requests SET state = 3, updated_at = ? WHERE id = ?`).bind(
        now.getTime(),
        removedRequest,
      ),
    ]);

    const result = await repo.postponeRequester({
      groupId: source.id,
      requestId: appendedRequest,
      actionKey: "postpone-gap-third",
      changedAt: now,
    });

    expect(result.source.members.map((member) => member.requestId)).toEqual([retainedRequest]);
    await expect(
      env.DB.prepare(
        `SELECT request_id AS requestId, position
         FROM raid_group_members WHERE group_id = ? AND state = 0 ORDER BY position`,
      )
        .bind(first.dedicated.id)
        .all(),
    ).resolves.toMatchObject({
      results: [
        { requestId: existingRequest, position: 2 },
        { requestId: appendedRequest, position: 3 },
      ],
    });
  });

  it("keeps requester postponement bounded with 10,000 removed source memberships", async () => {
    const repo = repository();
    const retainedRequest = await createRequest(repo, 1, "customs", "pve", 4);
    const postponedRequest = await createRequest(repo, 2, "customs", "pve", 4);
    const source = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );
    await seedWaitingRequests(10_000, { offset: 100_000 });
    await env.DB.prepare(
      `UPDATE help_requests SET state = 3
       WHERE source_delivery_id LIKE 'bulk-delivery-%'`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO raid_group_members
         (group_id, request_id, position, state, created_at, updated_at)
       SELECT ?, id, id + 100, 2, ?, ? FROM help_requests
       WHERE source_delivery_id LIKE 'bulk-delivery-%'`,
    )
      .bind(source.id, now.getTime() - 1, now.getTime() - 1)
      .run();
    const openRaidOrdinals = JSON.stringify(
      Array.from({ length: 10_000 }, (_, index) => index + 1),
    );
    await env.DB.prepare(
      `INSERT INTO raid_groups
         (is_priority, game_mode, sort_key, map_id, requester_capacity,
          automatic_fill, state, created_at, updated_at)
       SELECT 0, 1, source.sort_key + value * 1000000, 'factory', 4, 1, 0, ?, ?
       FROM json_each(?)
       JOIN raid_groups AS source ON source.id = ?`,
    )
      .bind(now.getTime(), now.getTime(), openRaidOrdinals, source.id)
      .run();
    const metrics = new D1Metrics(true);
    const measured = new D1MvpRepository(instrumentD1Database(env.DB, metrics));

    const result = await measured.postponeRequester({
      groupId: source.id,
      requestId: postponedRequest,
      actionKey: "postpone-with-history",
      changedAt: now,
    });

    expect(result.source.members.map((member) => member.requestId)).toEqual([retainedRequest]);
    expect(result.dedicated.members.map((member) => member.requestId)).toEqual([postponedRequest]);
    expect(metrics.snapshot().rowsRead).toBeLessThan(200);
  }, 20_000);

  it("creates another follow-up after a source-linked follow-up becomes full", async () => {
    const repo = repository();
    const retainedRequest = await createRequest(repo, 1);
    const firstPostponedRequest = await createRequest(repo, 2);
    const secondPostponedRequest = await createRequest(repo, 3);
    const source = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );
    const first = await repo.postponeRequester({
      groupId: source.id,
      requestId: firstPostponedRequest,
      actionKey: "postpone-before-fill",
      changedAt: now,
    });
    await createRequest(repo, 4);
    await createRequest(repo, 5);
    expect((await repo.getRaid(first.dedicated.id))?.members).toHaveLength(3);

    const second = await repo.postponeRequester({
      groupId: source.id,
      requestId: secondPostponedRequest,
      actionKey: "postpone-after-fill",
      changedAt: now,
    });

    expect(second.dedicated.id).not.toBe(first.dedicated.id);
    expect(second.source.members.map((member) => member.requestId)).toEqual([retainedRequest]);
    const board = await repo.getBoardSnapshot();
    expect(board.ordinaryRaids.map((raid) => raid.id)).toEqual([
      source.id,
      first.dedicated.id,
      second.dedicated.id,
    ]);
    expect(second.dedicated.members.map((member) => member.requestId)).toEqual([
      secondPostponedRequest,
    ]);
  });

  it.each([
    { mapId: "customs", requesterCapacity: 3 },
    { mapId: "icebreaker", requesterCapacity: 2 },
  ])(
    "keeps a $mapId follow-up within its $requesterCapacity-requester capacity",
    async ({ mapId, requesterCapacity }) => {
      const repo = repository();
      const postponedRequest = await createRequest(repo, 1, mapId);
      const source = await start(
        repo,
        (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
      );
      const postponed = await repo.postponeRequester({
        groupId: source.id,
        requestId: postponedRequest,
        actionKey: `postpone-${mapId}`,
        changedAt: now,
      });

      for (let index = 2; index <= requesterCapacity + 1; index += 1) {
        await createRequest(repo, index, mapId);
      }

      const board = await repo.getBoardSnapshot();
      expect(board.ordinaryRaidCount).toBe(2);
      expect(board.ordinaryRaids[0]).toMatchObject({
        id: postponed.dedicated.id,
        requesterCapacity,
      });
      expect(board.ordinaryRaids[0]?.members).toHaveLength(requesterCapacity);
      expect(board.ordinaryRaids[1]?.members).toHaveLength(1);
    },
  );

  it("does not fill a Priority requester follow-up with an Ordinary request", async () => {
    const repo = repository();
    const priorityRequest = await createRequest(repo, 1, "interchange");
    const ordinarySource = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    await postpone(repo, ordinarySource, "make-priority-source");
    const prioritySource = await start(
      repo,
      (await repo.getBoardSnapshot()).priorityRaids[0] as StaffBoardRaid,
    );
    const postponed = await repo.postponeRequester({
      groupId: prioritySource.id,
      requestId: priorityRequest,
      actionKey: "postpone-priority-requester",
      changedAt: now,
    });

    const ordinaryRequest = await createRequest(repo, 2, "interchange");

    const board = await repo.getBoardSnapshot();
    expect(board.priorityRaids[0]?.members.map((member) => member.requestId)).toEqual([
      priorityRequest,
    ]);
    expect(board.priorityRaids[0]?.id).toBe(postponed.dedicated.id);
    expect(board.ordinaryRaids[0]?.members.map((member) => member.requestId)).toEqual([
      ordinaryRequest,
    ]);
  });

  it("rolls back every requester-postponement mutation when follow-up creation fails", async () => {
    const repo = repository();
    for (let index = 1; index <= 4; index += 1) await createRequest(repo, index);
    const raids = (await repo.getBoardSnapshot()).ordinaryRaids;
    const source = await start(repo, raids[0] as StaffBoardRaid);
    await env.DB.prepare(`UPDATE raid_groups SET last_action_key = ? WHERE id = ?`)
      .bind("postpone-failure:postponed", raids[1]?.id)
      .run();
    await expect(
      repo.postponeRequester({
        groupId: source.id,
        requestId: source.members[0]?.requestId as number,
        actionKey: "postpone-failure",
        changedAt: now,
      }),
    ).rejects.toThrow();
    const unchanged = (await repo.getRaid(source.id)) as StaffBoardRaid;
    expect(unchanged.state).toBe("active");
    expect(unchanged.members.map((member) => member.requestId)).toEqual(
      source.members.map((member) => member.requestId),
    );
  });

  it("rolls back the source when a reusable follow-up rejects the membership", async () => {
    const repo = repository();
    const retainedRequest = await createRequest(repo, 1);
    const firstPostponedRequest = await createRequest(repo, 2);
    const secondPostponedRequest = await createRequest(repo, 3);
    const source = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );
    const first = await repo.postponeRequester({
      groupId: source.id,
      requestId: firstPostponedRequest,
      actionKey: "prepare-reusable-follow-up",
      changedAt: now,
    });
    await env.DB.prepare(
      `CREATE TRIGGER reject_reusable_follow_up
       BEFORE INSERT ON raid_group_members WHEN NEW.group_id = ${first.dedicated.id}
       BEGIN SELECT RAISE(ABORT, 'forced follow-up failure'); END`,
    ).run();

    try {
      await expect(
        repo.postponeRequester({
          groupId: source.id,
          requestId: secondPostponedRequest,
          actionKey: "reject-reusable-follow-up",
          changedAt: now,
        }),
      ).rejects.toThrow("forced follow-up failure");
    } finally {
      await env.DB.prepare(`DROP TRIGGER reject_reusable_follow_up`).run();
    }

    const unchangedSource = (await repo.getRaid(source.id)) as StaffBoardRaid;
    expect(unchangedSource.state).toBe("active");
    expect(unchangedSource.members.map((member) => member.requestId)).toEqual([
      retainedRequest,
      secondPostponedRequest,
    ]);
    expect(
      (await repo.getRaid(first.dedicated.id))?.members.map((member) => member.requestId),
    ).toEqual([firstPostponedRequest]);
  });

  it("closes the empty source when its last requester is postponed", async () => {
    const repo = repository();
    const requestId = await createRequest(repo, 1);
    const raid = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    await start(repo, raid);
    await repo.setRaidStaffMessage(raid.id, "old-message", now);

    const result = await repo.postponeRequester({
      groupId: raid.id,
      requestId,
      actionKey: "postpone-last",
      changedAt: now,
    });

    expect(result.source).toMatchObject({
      state: "canceled",
      outcome: "not_run",
    });
    expect(result.source.staffMessageId).toBeUndefined();
    expect(result.dedicated).toMatchObject({
      queueKind: "ordinary",
      state: "planned",
      automaticFill: true,
      leaderDiscordUserId: "leader",
    });
    expect((await repo.getBoardSnapshot()).ordinaryRaids.map((group) => group.id)).toEqual([
      result.dedicated.id,
    ]);
    await expect(currentMemberCount(raid.id)).resolves.toBe(0);
    await expect(currentMemberCount(result.dedicated.id)).resolves.toBe(1);
  });

  it("removes requests permanently and closes a source after its last requester", async () => {
    const repo = repository();
    const firstRequest = await createRequest(repo, 1);
    const secondRequest = await createRequest(repo, 2);
    const raid = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    await start(repo, raid);
    await repo.setRaidStaffMessage(raid.id, "remove-message", now);

    const remaining = await repo.removeRequester({
      groupId: raid.id,
      requestId: secondRequest,
      actionKey: "remove-second",
      changedAt: now,
    });
    expect(remaining).toMatchObject({ state: "active" });
    expect(remaining.members.map((member) => member.requestId)).toEqual([firstRequest]);
    await expect(currentMemberCount(raid.id)).resolves.toBe(1);

    const closed = await repo.removeRequester({
      groupId: raid.id,
      requestId: firstRequest,
      actionKey: "remove-first",
      changedAt: now,
    });
    expect(closed).toMatchObject({ state: "canceled", outcome: "not_run" });
    expect(closed.staffMessageId).toBeUndefined();
    await expect(currentMemberCount(raid.id)).resolves.toBe(0);
    expect((await repo.getBoardSnapshot()).ordinaryRaids).toEqual([]);
    const requests = await env.DB.prepare(
      `SELECT id, CASE state WHEN 3 THEN 'canceled' ELSE 'other' END AS state
       FROM help_requests ORDER BY id`,
    ).all<{ id: number; state: string }>();
    expect(requests.results).toEqual([
      { id: firstRequest, state: "canceled" },
      { id: secondRequest, state: "canceled" },
    ]);
  });

  it("moves the same whole raid to the end of priority with attempts reset", async () => {
    const repo = repository();
    for (let index = 1; index <= 4; index += 1) await createRequest(repo, index);
    const ordinary = (await repo.getBoardSnapshot()).ordinaryRaids;
    await postpone(repo, ordinary[0] as StaffBoardRaid, "existing-priority");
    const source = ordinary[1] as StaffBoardRaid;
    const started = await start(repo, source);
    await repo.updateCallStatus(started.id, "discord", "sent", now);
    await repo.setRaidStaffMessage(started.id, "postpone-message", now);

    const postponed = await repo.postponeRaid({
      groupId: started.id,
      actionKey: "postpone-whole-raid",
      changedAt: now,
    });
    expect(postponed).toMatchObject({
      id: started.id,
      queueKind: "priority",
      state: "planned",
      attemptCount: 0,
      automaticFill: false,
      leaderDiscordUserId: "leader",
      discordCallStatus: "not_requested",
      twitchCallStatus: "not_requested",
    });
    expect(postponed.staffMessageId).toBeUndefined();
    expect(postponed.members.map((member) => member.requestId)).toEqual(
      started.members.map((member) => member.requestId),
    );
    const requests = await env.DB.prepare(
      `SELECT CASE is_priority WHEN 1 THEN 'priority' ELSE 'ordinary' END AS queueKind,
              CASE state WHEN 1 THEN 'planned' ELSE 'other' END AS state
       FROM help_requests
       WHERE id IN (${started.members.map(() => "?").join(",")}) ORDER BY id`,
    )
      .bind(...started.members.map((member) => member.requestId))
      .all<{ queueKind: string; state: string }>();
    expect(requests.results).toEqual(
      started.members.map(() => ({ queueKind: "priority", state: "planned" })),
    );

    await start(repo, postponed);
    const postponedAgain = await repo.postponeRaid({
      groupId: postponed.id,
      actionKey: "postpone-priority-again",
      changedAt: now,
    });
    expect(postponedAgain).toMatchObject({
      id: postponed.id,
      queueKind: "priority",
      state: "planned",
      attemptCount: 0,
      leaderDiscordUserId: "leader",
    });
  });

  it("keeps removed membership history out of open board hydration", async () => {
    const repo = repository();
    await createRequest(repo, 1);
    const raid = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    await seedWaitingRequests(10_000, { offset: 1 });
    await env.DB.prepare(`UPDATE help_requests SET state = 3 WHERE id > 1`).run();
    const history = Array.from({ length: 10_000 }, (_, index) => ({
      requestId: index + 2,
      position: index + 2,
    }));
    await env.DB.prepare(
      `INSERT INTO raid_group_members
         (group_id, request_id, position, state, created_at, updated_at)
       SELECT ?, json_extract(value, '$.requestId'), json_extract(value, '$.position'), 2, ?, ?
       FROM json_each(?)`,
    )
      .bind(raid.id, now.getTime(), now.getTime(), JSON.stringify(history))
      .run();
    const metrics = new D1Metrics();
    const measured = new D1MvpRepository(instrumentD1Database(env.DB, metrics));

    const snapshot = await measured.getBoardSnapshot();

    expect(snapshot.ordinaryRaids[0]?.members).toHaveLength(1);
    expect(metrics.snapshot().rowsRead).toBeLessThan(100);
    const raidMetrics = new D1Metrics();
    await new D1MvpRepository(instrumentD1Database(env.DB, raidMetrics)).getRaid(raid.id);
    expect(raidMetrics.snapshot().rowsRead).toBeLessThan(20);
  });

  it("captures statement details only when explicitly enabled", async () => {
    const totalsOnly = new D1Metrics();
    await new D1MvpRepository(instrumentD1Database(env.DB, totalsOnly)).getDiagnostics();
    expect(totalsOnly.statementDetails()).toEqual([]);

    const detailed = new D1Metrics(true);
    await new D1MvpRepository(instrumentD1Database(env.DB, detailed)).getDiagnostics();
    expect(detailed.statementDetails()).toHaveLength(3);
    expect(detailed.statementDetails().every((statement) => statement.queryId.length > 0)).toBe(
      true,
    );
    expect(
      detailed.statementDetails().reduce((sum, statement) => sum + statement.statements, 0),
    ).toBe(detailed.snapshot().statements);
  });

  it("retains completed participants in historical single-raid reads", async () => {
    const repo = repository();
    await createRequest(repo, 1);
    const raid = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );
    const completed = await repo.recordRaidResult({
      groupId: raid.id,
      outcome: "helped",
      attemptLimit: 3,
      actionKey: "completed-history",
      changedAt: now,
    });

    expect(completed.state).toBe("completed");
    expect(completed.members.map((member) => member.twitchLogin)).toEqual(["viewer_1"]);
    await expect(repo.getRaid(raid.id)).resolves.toMatchObject({
      state: "completed",
      members: [{ twitchLogin: "viewer_1" }],
    });
  });

  it("does not mutate outstanding raids during an empty legacy repair", async () => {
    const repo = repository();
    await createRequest(repo, 1);
    const before = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    await repo.repairLegacyUnassignedRequests({
      changedAt: new Date("2196-08-16T04:00:00.000Z"),
      recipientLimit: 3,
    });
    const after = (await repo.getBoardSnapshot()).ordinaryRaids[0];
    expect(after).toMatchObject({
      id: before.id,
      queueKind: before.queueKind,
      state: before.state,
      attemptCount: before.attemptCount,
    });
  });

  it("checks only for unassigned requests in the empty legacy-repair path", async () => {
    const repo = repository();
    await createRequest(repo, 1);
    const metrics = new D1Metrics();
    const measured = new D1MvpRepository(instrumentD1Database(env.DB, metrics));
    await expect(
      measured.repairLegacyUnassignedRequests({ recipientLimit: 3, changedAt: now }),
    ).resolves.toEqual({ repaired: 0, hasMore: false });
    expect(metrics.snapshot().statements).toBe(2);
  });

  it("repairs a legacy backlog smaller than one batch and keeps every requester", async () => {
    await seedWaitingRequests(60);
    const metrics = new D1Metrics();
    const measured = new D1MvpRepository(instrumentD1Database(env.DB, metrics));
    await expect(
      measured.repairLegacyUnassignedRequests({ recipientLimit: 3, changedAt: now }),
    ).resolves.toEqual({ repaired: 60, hasMore: false });
    expect(metrics.snapshot().statements).toBe(7);
    const stored = await env.DB.prepare(
      `SELECT count(*) AS requestCount,
              (SELECT count(*) FROM raid_groups WHERE state = 0) AS raidCount,
              (SELECT count(*) FROM raid_group_members WHERE state = 0) AS memberCount
         FROM help_requests WHERE state = 1`,
    ).first<{ requestCount: number; raidCount: number; memberCount: number }>();
    expect(stored).toEqual({ requestCount: 60, raidCount: 20, memberCount: 60 });
  }, 15_000);

  it("appends legacy recovery after the highest active position when a gap exists", async () => {
    const repo = repository();
    const removedRequest = await createRequest(repo, 1, "customs", "pve", 3);
    await createRequest(repo, 2, "customs", "pve", 3);
    await createRequest(repo, 3, "customs", "pve", 3);
    const raid = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    await env.DB.batch([
      env.DB.prepare(
        `UPDATE raid_group_members SET state = 2, updated_at = ?
         WHERE group_id = ? AND request_id = ? AND state = 0`,
      ).bind(now.getTime(), raid.id, removedRequest),
      env.DB.prepare(`UPDATE help_requests SET state = 3, updated_at = ? WHERE id = ?`).bind(
        now.getTime(),
        removedRequest,
      ),
    ]);
    await seedWaitingRequests(1, { offset: 10_000 });

    await expect(
      repo.repairLegacyUnassignedRequests({ recipientLimit: 3, changedAt: now }),
    ).resolves.toEqual({ repaired: 1, hasMore: false });
    await expect(
      env.DB.prepare(
        `SELECT member.position
         FROM raid_group_members AS member
         JOIN help_requests AS request ON request.id = member.request_id
         WHERE member.group_id = ? AND member.state = 0
           AND request.source_delivery_id = 'bulk-delivery-10001'`,
      )
        .bind(raid.id)
        .first(),
    ).resolves.toEqual({ position: 4 });
  });

  it("bounds and drains a 1,000-request recovery backlog in 80-request lookahead batches", async () => {
    const repo = repository();
    await seedWaitingRequests(1_000);

    for (const expectedWaiting of Array.from({ length: 13 }, (_, index) =>
      Math.max(1_000 - (index + 1) * 80, 0),
    )) {
      // Recovery intentionally advances one bounded batch per invocation.
      await expect(
        repo.repairLegacyUnassignedRequests({ recipientLimit: 3, changedAt: now }),
      ).resolves.toEqual({
        repaired: expectedWaiting === 0 ? 40 : 80,
        hasMore: expectedWaiting > 0,
      });
      await expect(
        env.DB.prepare(`SELECT count(*) AS count FROM help_requests WHERE state = 0`).first(),
      ).resolves.toEqual({ count: expectedWaiting });
    }
  }, 15_000);

  it("reads and materializes only one bounded batch from 10,000 waiting requests", async () => {
    await seedWaitingRequests(10_000);
    const metrics = new D1Metrics();
    const measured = new D1MvpRepository(instrumentD1Database(env.DB, metrics));

    await expect(
      measured.repairLegacyUnassignedRequests({ recipientLimit: 3, changedAt: now }),
    ).resolves.toEqual({ repaired: 80, hasMore: true });
    expect(metrics.snapshot().rowsRead).toBeLessThanOrEqual(2_500);
    expect(metrics.snapshot().rowsWritten).toBeLessThanOrEqual(1_000);
    await expect(
      env.DB.prepare(
        `SELECT sum(state = 0) AS waiting, sum(state = 1) AS planned FROM help_requests`,
      ).first(),
    ).resolves.toEqual({ waiting: 9_920, planned: 80 });
  }, 20_000);

  it("ignores a large unrelated partial-raid population during bounded repair", async () => {
    await ensureCommunityState();
    await seedWaitingRequests(80);
    const unrelated = JSON.stringify(Array.from({ length: 10_000 }, (_, index) => index + 1));
    await env.DB.prepare(
      `INSERT INTO raid_groups
         (is_priority, game_mode, sort_key, map_id, requester_capacity,
          automatic_fill, state, created_at, updated_at)
       SELECT 0, 1, value * 1000000, 'factory', 4, 1, 0, ?, ?
       FROM json_each(?)`,
    )
      .bind(now.getTime(), now.getTime(), unrelated)
      .run();
    const metrics = new D1Metrics();
    const measured = new D1MvpRepository(instrumentD1Database(env.DB, metrics));

    await expect(
      measured.repairLegacyUnassignedRequests({ recipientLimit: 3, changedAt: now }),
    ).resolves.toEqual({ repaired: 80, hasMore: false });
    expect(metrics.snapshot().rowsRead).toBeLessThan(2_500);
  }, 20_000);

  it("limits compatible legacy candidates before hydrating a large raid population", async () => {
    await ensureCommunityState();
    await seedWaitingRequests(80);
    const candidates = JSON.stringify(Array.from({ length: 10_000 }, (_, index) => index + 1));
    await env.DB.prepare(
      `INSERT INTO raid_groups
         (is_priority, game_mode, sort_key, map_id, requester_capacity,
          automatic_fill, state, created_at, updated_at)
       SELECT 0, 2, value * 1000000, 'customs', 3, 1, 0, ?, ?
       FROM json_each(?)`,
    )
      .bind(now.getTime(), now.getTime(), candidates)
      .run();
    const metrics = new D1Metrics(true);
    const measured = new D1MvpRepository(instrumentD1Database(env.DB, metrics));

    await expect(
      measured.repairLegacyUnassignedRequests({ recipientLimit: 3, changedAt: now }),
    ).resolves.toEqual({ repaired: 80, hasMore: false });

    const candidateUsage = metrics
      .statementDetails()
      .filter((statement) => statement.queryId === "assignment.legacy_candidates");
    expect(candidateUsage).toHaveLength(1);
    expect(candidateUsage[0]?.rowsRead).toBeLessThan(200);
    expect(metrics.snapshot().rowsRead).toBeLessThan(2_500);
  }, 20_000);

  it("reserves every non-empty queue-kind and mode pair outside the FIFO batch", async () => {
    await seedWaitingRequests(600, {
      gameMode: (index) => {
        if (index === 301 || index === 599) return 1;
        if (index === 302 || index === 600) return 0;
        return 2;
      },
      isPriority: (index) => (index <= 302 ? 1 : 0),
    });

    await expect(
      repository().repairLegacyUnassignedRequests({ recipientLimit: 3, changedAt: now }),
    ).resolves.toEqual({ repaired: 80, hasMore: true });
    const reserved = await env.DB.prepare(
      `SELECT id, state FROM help_requests WHERE id IN (1, 301, 302, 303, 599, 600) ORDER BY id`,
    ).all<{ id: number; state: number }>();
    expect(reserved.results).toEqual([
      { id: 1, state: 1 },
      { id: 301, state: 1 },
      { id: 302, state: 1 },
      { id: 303, state: 1 },
      { id: 599, state: 1 },
      { id: 600, state: 1 },
    ]);
  });

  it("keeps concurrent recovery within capacity with unique contiguous positions", async () => {
    await seedWaitingRequests(500);
    const results = await Promise.all(
      [0, 1].map((offset) =>
        repository().repairLegacyUnassignedRequests({
          recipientLimit: 3,
          changedAt: new Date(now.getTime() + offset),
        }),
      ),
    );
    expect(results.every((result) => result.repaired <= 80)).toBe(true);
    expect(results.reduce((total, result) => total + result.repaired, 0)).toBe(160);
    const invalidGroups = await env.DB.prepare(
      `SELECT raid.id
       FROM raid_groups AS raid
       JOIN raid_group_members AS member ON member.group_id = raid.id AND member.state = 0
       GROUP BY raid.id
       HAVING count(*) > raid.requester_capacity
          OR count(*) <> count(DISTINCT member.position)
          OR min(member.position) <> 1 OR max(member.position) <> count(*)`,
    ).all();
    expect(invalidGroups.results).toEqual([]);
    await expect(
      env.DB.prepare(
        `SELECT count(*) AS count FROM help_requests AS request
         WHERE request.state = 1 AND NOT EXISTS (
           SELECT 1 FROM raid_group_members AS member
           WHERE member.request_id = request.id AND member.state = 0
         )`,
      ).first(),
    ).resolves.toEqual({ count: 0 });
    await expect(
      env.DB.prepare(
        `SELECT sum(state = 0) AS waiting, sum(state = 1) AS planned FROM help_requests`,
      ).first(),
    ).resolves.toEqual({ waiting: 340, planned: 160 });
  });

  it("expires old delivery receipts only during leased maintenance", async () => {
    const repo = repository();
    await ensureCommunityState();
    const old = new Date(now.getTime() - 25 * 60 * 60 * 1_000);
    await repo.claimDiscordMutation("old", "component", old, old);
    await expect(repo.claimDiscordMutation("recent", "component", now, now)).resolves.toEqual(
      expect.any(String),
    );
    await expect(
      repo.claimDiscordMutation("recent", "component", now, now),
    ).resolves.toBeUndefined();
    await expect(repo.maintainExpiredReceipts(now)).resolves.toEqual({ ran: true, deleted: 1 });
    const receipts = await env.DB.prepare(
      `SELECT delivery_id AS deliveryId FROM event_receipts ORDER BY delivery_id`,
    ).all<{ deliveryId: string }>();
    expect(receipts.results).toEqual([{ deliveryId: "recent" }]);
  });

  it("serializes board drains and preserves changes that arrive during rendering", async () => {
    await ensureCommunityState();
    const repo = repository();
    await repo.setCanonicalBoardMessage({
      messageId: "canonical-board",
      renderedVersion: 0,
      changedAt: now,
    });
    for (let index = 0; index < 10; index += 1) {
      await repo.markBoardDirty(new Date(now.getTime() + index));
    }
    const claims = await Promise.all(
      Array.from({ length: 10 }, (_, index) =>
        repo.acquireBoardDrainLease({
          token: `lease-${index}`,
          changedAt: now,
          createIfMissing: false,
        }),
      ),
    );
    const winner = claims.find((claim) => claim !== undefined);
    expect(claims.filter((claim) => claim !== undefined)).toHaveLength(1);
    expect(winner).toMatchObject({ dirtyVersion: 10, renderedVersion: 0 });

    await repo.markBoardDirty(new Date(now.getTime() + 20));
    await expect(
      repo.completeBoardDrain({
        token: winner?.token ?? "missing",
        renderedVersion: winner?.dirtyVersion ?? 0,
        expectedMessageId: "canonical-board",
        changedAt: new Date(now.getTime() + 21),
      }),
    ).resolves.toMatchObject({ applied: true, current: false, hasMore: true });
    const followUp = await repo.acquireBoardDrainLease({
      token: "follow-up",
      changedAt: new Date(now.getTime() + 22),
      createIfMissing: false,
    });
    expect(followUp).toMatchObject({ dirtyVersion: 11, renderedVersion: 10 });
    await expect(
      repo.completeBoardDrain({
        token: "follow-up",
        renderedVersion: followUp?.dirtyVersion ?? 0,
        expectedMessageId: "canonical-board",
        changedAt: new Date(now.getTime() + 23),
      }),
    ).resolves.toMatchObject({ applied: true, current: true, hasMore: false });
    await expect(
      repo.acquireBoardDrainLease({
        token: "none",
        changedAt: new Date(now.getTime() + 24),
        createIfMissing: false,
      }),
    ).resolves.toBeUndefined();
  });

  it("reclaims only incomplete expired Discord mutation receipts", async () => {
    const repo = repository();
    const firstToken = await repo.claimDiscordMutation("retryable", "component", now, now);
    expect(firstToken).toEqual(expect.any(String));
    await expect(
      repo.claimDiscordMutation("retryable", "component", now, now),
    ).resolves.toBeUndefined();
    await repo.releaseDiscordMutation("retryable", firstToken ?? "missing");
    const secondToken = await repo.claimDiscordMutation("retryable", "component", now, now);
    expect(secondToken).toEqual(expect.any(String));
    const reclaimedToken = await repo.claimDiscordMutation(
      "retryable",
      "component",
      now,
      new Date(now.getTime() + 5 * 60 * 1_000),
    );
    expect(reclaimedToken).toEqual(expect.any(String));
    expect(reclaimedToken).not.toBe(secondToken);
    await repo.completeDiscordMutation("retryable", secondToken ?? "missing");
    await repo.completeDiscordMutation("retryable", reclaimedToken ?? "missing");
    await expect(
      repo.claimDiscordMutation(
        "retryable",
        "component",
        now,
        new Date(now.getTime() + 10 * 60 * 1_000),
      ),
    ).resolves.toBeUndefined();
    await expect(
      env.DB.prepare(
        `SELECT discord_mutation_status AS status, discord_claim_until AS claimUntil
         FROM event_receipts WHERE platform = 0 AND delivery_id = 'retryable'`,
      ).first(),
    ).resolves.toEqual({ status: 1, claimUntil: null });
  });

  it("deletes expired Discord receipts in oldest-first leased batches of 100", async () => {
    await ensureCommunityState();
    const rows = Array.from({ length: 600 }, (_, index) => ({ index }));
    await env.DB.prepare(
      `INSERT INTO event_receipts (platform, delivery_id, event_type, received_at)
       SELECT 0, printf('expired-discord-%03d', json_extract(value, '$.index')), 'component',
              ? + json_extract(value, '$.index')
       FROM json_each(?)`,
    )
      .bind(now.getTime() - 48 * 60 * 60 * 1_000, JSON.stringify(rows))
      .run();

    const repo = repository();
    await expect(repo.claimDiscordMutation("current-one", "component", now, now)).resolves.toEqual(
      expect.any(String),
    );
    await expect(repo.maintainExpiredReceipts(now)).resolves.toEqual({ ran: true, deleted: 100 });
    await expect(
      env.DB.prepare(
        `SELECT count(*) AS count, min(delivery_id) AS oldest
         FROM event_receipts WHERE delivery_id LIKE 'expired-discord-%'`,
      ).first(),
    ).resolves.toEqual({ count: 500, oldest: "expired-discord-100" });
    await expect(repo.claimDiscordMutation("current-two", "component", now, now)).resolves.toEqual(
      expect.any(String),
    );
    await expect(repo.maintainExpiredReceipts(now)).resolves.toEqual({ ran: false, deleted: 0 });
    const nextLease = new Date(now.getTime() + 15 * 60 * 1_000);
    await expect(repo.maintainExpiredReceipts(nextLease)).resolves.toEqual({
      ran: true,
      deleted: 100,
    });
    await expect(
      env.DB.prepare(
        `SELECT count(*) AS count, min(delivery_id) AS oldest
         FROM event_receipts WHERE delivery_id LIKE 'expired-discord-%'`,
      ).first(),
    ).resolves.toEqual({ count: 400, oldest: "expired-discord-200" });
  });

  it("allows one concurrent receipt-maintenance winner and drains on later leases", async () => {
    await ensureCommunityState();
    const rows = Array.from({ length: 250 }, (_, index) => ({ index }));
    await env.DB.prepare(
      `INSERT INTO event_receipts (platform, delivery_id, event_type, received_at)
       SELECT 0, printf('lease-race-%03d', json_extract(value, '$.index')), 'component', ?
       FROM json_each(?)`,
    )
      .bind(now.getTime() - 48 * 60 * 60 * 1_000, JSON.stringify(rows))
      .run();
    const first = await Promise.all([
      repository().maintainExpiredReceipts(now),
      repository().maintainExpiredReceipts(now),
    ]);
    expect(first.filter((result) => result.ran)).toEqual([{ ran: true, deleted: 100 }]);
    await expect(
      repository().maintainExpiredReceipts(new Date(now.getTime() + 15 * 60 * 1_000)),
    ).resolves.toEqual({ ran: true, deleted: 100 });
    await expect(
      repository().maintainExpiredReceipts(new Date(now.getTime() + 30 * 60 * 1_000)),
    ).resolves.toEqual({ ran: true, deleted: 50 });
  });

  it("keeps cleanup failure non-destructive until a later lease", async () => {
    await ensureCommunityState();
    await env.DB.prepare(
      `INSERT INTO event_receipts (platform, delivery_id, event_type, received_at)
       VALUES (0, 'cleanup-failure', 'component', ?)`,
    )
      .bind(now.getTime() - 48 * 60 * 60 * 1_000)
      .run();
    await env.DB.prepare(
      `CREATE TRIGGER test_fail_receipt_cleanup
       BEFORE DELETE ON event_receipts
       BEGIN
         SELECT RAISE(ABORT, 'simulated cleanup failure');
       END`,
    ).run();
    await expect(repository().maintainExpiredReceipts(now)).rejects.toThrow(
      "simulated cleanup failure",
    );
    await env.DB.prepare("DROP TRIGGER test_fail_receipt_cleanup").run();
    await expect(
      repository().maintainExpiredReceipts(new Date(now.getTime() + 1)),
    ).resolves.toEqual({ ran: false, deleted: 0 });
    await expect(
      repository().maintainExpiredReceipts(new Date(now.getTime() + 15 * 60 * 1_000)),
    ).resolves.toEqual({ ran: true, deleted: 1 });
  });

  it("bounds expired-receipt cleanup while recording a Twitch reply", async () => {
    await ensureCommunityState();
    const rows = Array.from({ length: 300 }, (_, index) => ({ index }));
    await env.DB.prepare(
      `INSERT INTO event_receipts (platform, delivery_id, event_type, received_at)
       SELECT 1, printf('expired-twitch-%03d', json_extract(value, '$.index')), 'command:queue',
              ? + json_extract(value, '$.index')
       FROM json_each(?)`,
    )
      .bind(now.getTime() - 48 * 60 * 60 * 1_000, JSON.stringify(rows))
      .run();

    const repo = repository();
    const commandClaim = await repo.claimTwitchCommand({
      deliveryId: "current-twitch",
      eventType: "command:queue",
      receivedAt: now,
      claimedAt: now,
    });
    expect(commandClaim.outcome).toBe("claimed");
    if (commandClaim.outcome !== "claimed") throw new Error("Twitch claim was not acquired");
    await expect(
      repo.completeTwitchCommand({
        deliveryId: "current-twitch",
        claimToken: commandClaim.claimToken,
        replyText: "Current reply",
      }),
    ).resolves.toMatchObject({ replyText: "Current reply", replyStatus: "pending" });
    await expect(repo.maintainExpiredReceipts(now)).resolves.toEqual({ ran: true, deleted: 100 });
    await expect(
      env.DB.prepare(
        `SELECT count(*) AS count, min(delivery_id) AS oldest
         FROM event_receipts WHERE delivery_id LIKE 'expired-twitch-%'`,
      ).first(),
    ).resolves.toEqual({ count: 200, oldest: "expired-twitch-100" });
  });

  it("reclaims an expired Twitch command with wall-clock time and fences the stale worker", async () => {
    const repo = repository();
    const first = await repo.claimTwitchCommand({
      deliveryId: "abandoned-twitch-command",
      eventType: "command:queue",
      receivedAt: now,
      claimedAt: now,
    });
    expect(first.outcome).toBe("claimed");
    if (first.outcome !== "claimed") throw new Error("The first Twitch claim was not acquired");
    await expect(
      repo.claimTwitchCommand({
        deliveryId: "abandoned-twitch-command",
        eventType: "command:queue",
        receivedAt: now,
        claimedAt: new Date(now.getTime() + 60_000),
      }),
    ).resolves.toEqual({ outcome: "processing" });

    const reclaimed = await repo.claimTwitchCommand({
      deliveryId: "abandoned-twitch-command",
      eventType: "command:queue",
      receivedAt: now,
      claimedAt: new Date(now.getTime() + 2 * 60_000),
    });
    expect(reclaimed.outcome).toBe("claimed");
    if (reclaimed.outcome !== "claimed") throw new Error("The Twitch claim was not reclaimed");
    expect(reclaimed.claimToken).not.toBe(first.claimToken);
    await expect(
      repo.completeTwitchCommand({
        deliveryId: "abandoned-twitch-command",
        claimToken: first.claimToken,
        replyText: "Stale reply",
      }),
    ).rejects.toThrow("processing claim expired");
    await expect(
      repo.completeTwitchCommand({
        deliveryId: "abandoned-twitch-command",
        claimToken: reclaimed.claimToken,
        replyText: "Current reply",
      }),
    ).resolves.toMatchObject({ replyText: "Current reply", replyStatus: "pending" });
  });

  it("advances the observation time without changing an unchanged Twitch identity", async () => {
    const repo = repository();
    await repo.observeTwitchIdentity({
      twitchLogin: "same_viewer",
      twitchUserId: "same-twitch-id",
      observedAt: now,
    });
    const metrics = new D1Metrics();
    const measured = new D1MvpRepository(instrumentD1Database(env.DB, metrics));
    await measured.observeTwitchIdentity({
      twitchLogin: "same_viewer",
      twitchUserId: "same-twitch-id",
      observedAt: new Date(now.getTime() + 60_000),
    });

    expect(metrics.snapshot()).toMatchObject({ statements: 3 });
    await expect(
      env.DB.prepare(
        `SELECT twitch_user_id AS twitchUserId, updated_at AS updatedAt,
                twitch_observed_at AS twitchObservedAt
         FROM user_mappings WHERE twitch_login = 'same_viewer'`,
      ).first(),
    ).resolves.toEqual({
      twitchUserId: "same-twitch-id",
      updatedAt: now.getTime() + 60_000,
      twitchObservedAt: now.getTime() + 60_000,
    });
  });

  it("moves a conflicting Twitch platform ID to its newly observed login", async () => {
    const repo = repository();
    await repo.observeTwitchIdentity({
      twitchLogin: "old_login",
      twitchUserId: "shared-twitch-id",
      observedAt: now,
    });
    await repo.observeTwitchIdentity({
      twitchLogin: "new_login",
      twitchUserId: "shared-twitch-id",
      observedAt: new Date(now.getTime() + 1),
    });

    const mappings = await env.DB.prepare(
      `SELECT twitch_login AS twitchLogin, twitch_user_id AS twitchUserId
       FROM user_mappings ORDER BY twitch_login`,
    ).all<{ twitchLogin: string; twitchUserId: string | null }>();
    expect(mappings.results).toEqual([
      { twitchLogin: "new_login", twitchUserId: "shared-twitch-id" },
    ]);
  });

  it("ignores a delayed identity observation after a newer login move", async () => {
    const repo = repository();
    const first = new Date(now.getTime() + 1_000);
    const latest = new Date(now.getTime() + 3_000);
    await repo.observeTwitchIdentity({
      twitchLogin: "identity_old",
      twitchUserId: "monotonic-stable-id",
      observedAt: first,
    });
    const created = await repo.createRequest({
      sourcePlatform: "twitch",
      sourceDeliveryId: "monotonic-original-request",
      twitchUserId: "monotonic-stable-id",
      twitchLogin: "identity_old",
      gameMode: "pve",
      inGameName: "Monotonic PMC",
      mapId: "customs",
      objective: "Keep the newest login",
      recipientLimit: 4,
      observedAt: first,
    });
    await repo.observeTwitchIdentity({
      twitchLogin: "identity_new",
      twitchUserId: "monotonic-stable-id",
      observedAt: latest,
    });

    await repo.observeTwitchIdentity({
      twitchLogin: "identity_old",
      twitchUserId: "monotonic-stable-id",
      observedAt: new Date(now.getTime() + 2_000),
    });

    await expect(
      env.DB.prepare(
        `SELECT twitch_login AS twitchLogin, twitch_observed_at AS twitchObservedAt
         FROM user_mappings WHERE twitch_user_id = 'monotonic-stable-id'`,
      ).first(),
    ).resolves.toEqual({ twitchLogin: "identity_new", twitchObservedAt: latest.getTime() });
    await expect(
      env.DB.prepare(`SELECT twitch_login AS twitchLogin FROM help_requests WHERE id = ?`)
        .bind(created.request.id)
        .first(),
    ).resolves.toEqual({ twitchLogin: "identity_new" });
  });

  it("uses the newest stable login for delayed Twitch request intake", async () => {
    const repo = repository();
    await repo.observeTwitchIdentity({
      twitchLogin: "request_new_login",
      twitchUserId: "request-monotonic-id",
      observedAt: new Date(now.getTime() + 5_000),
    });

    const created = await repo.createRequest({
      sourcePlatform: "twitch",
      sourceDeliveryId: "delayed-twitch-request",
      twitchUserId: "request-monotonic-id",
      twitchLogin: "request_old_login",
      gameMode: "pve",
      inGameName: "Delayed PMC",
      mapId: "woods",
      objective: "Process without reverting identity",
      recipientLimit: 4,
      observedAt: new Date(now.getTime() + 4_000),
    });

    await expect(
      env.DB.prepare(`SELECT twitch_login AS twitchLogin FROM help_requests WHERE id = ?`)
        .bind(created.request.id)
        .first(),
    ).resolves.toEqual({ twitchLogin: "request_new_login" });
    await expect(
      env.DB.prepare(
        `SELECT twitch_login AS twitchLogin, twitch_observed_at AS twitchObservedAt
         FROM user_mappings WHERE twitch_user_id = 'request-monotonic-id'`,
      ).first(),
    ).resolves.toEqual({
      twitchLogin: "request_new_login",
      twitchObservedAt: now.getTime() + 5_000,
    });
  });

  it("does not transfer profile data when a verified Twitch login is recycled", async () => {
    const repo = repository();
    await repo.upsertUserMapping({
      twitchLogin: "original_login",
      twitchUserId: "stable-original",
      discordUserId: "discord-original",
      discordDisplayName: "Original Discord",
      inGameName: "Original PMC",
      observedAt: now,
    });
    await repo.upsertUserMapping({
      twitchLogin: "recycled_login",
      twitchUserId: "stable-owner",
      discordUserId: "discord-owner",
      discordDisplayName: "Owner Discord",
      inGameName: "Owner PMC",
      observedAt: now,
    });

    await expect(
      repo.observeTwitchIdentity({
        twitchLogin: "recycled_login",
        twitchUserId: "stable-original",
        observedAt: new Date(now.getTime() + 1),
      }),
    ).rejects.toThrow("belongs to another verified Twitch identity");
    await expect(
      repo.createRequest({
        sourcePlatform: "twitch",
        sourceDeliveryId: "recycled-login-request",
        twitchUserId: "stable-original",
        twitchLogin: "recycled_login",
        gameMode: "pve",
        inGameName: "Untrusted PMC",
        mapId: "customs",
        objective: "Do not create this request",
        recipientLimit: 4,
        observedAt: new Date(now.getTime() + 2),
      }),
    ).rejects.toThrow("belongs to another verified Twitch identity");

    await expect(
      env.DB.prepare(
        `SELECT twitch_login AS twitchLogin, twitch_user_id AS twitchUserId,
                discord_user_id AS discordUserId,
                discord_display_name AS discordDisplayName, in_game_name AS inGameName
         FROM user_mappings ORDER BY twitch_login`,
      ).all(),
    ).resolves.toMatchObject({
      results: [
        {
          twitchLogin: "original_login",
          twitchUserId: "stable-original",
          discordUserId: "discord-original",
          discordDisplayName: "Original Discord",
          inGameName: "Original PMC",
        },
        {
          twitchLogin: "recycled_login",
          twitchUserId: "stable-owner",
          discordUserId: "discord-owner",
          discordDisplayName: "Owner Discord",
          inGameName: "Owner PMC",
        },
      ],
    });
    await expect(
      env.DB.prepare(`SELECT count(*) AS count FROM help_requests`).first(),
    ).resolves.toEqual({ count: 0 });
  });

  it("keeps queue access and active uniqueness after a Twitch login rename", async () => {
    const repo = repository();
    await repo.upsertUserMapping({
      twitchLogin: "before_rename",
      twitchUserId: "stable-rename-id",
      discordUserId: "rename-discord",
      discordDisplayName: "Rename Discord",
      inGameName: "Rename PMC",
      observedAt: now,
    });
    const created = await repo.createRequest({
      sourcePlatform: "twitch",
      sourceDeliveryId: "before-rename-request",
      twitchUserId: "stable-rename-id",
      twitchLogin: "before_rename",
      gameMode: "pve",
      inGameName: "Rename PMC",
      mapId: "customs",
      objective: "Keep this request",
      recipientLimit: 4,
      observedAt: now,
    });

    await repo.observeTwitchIdentity({
      twitchLogin: "after_rename",
      twitchUserId: "stable-rename-id",
      observedAt: new Date(now.getTime() + 1),
    });

    await expect(
      repo.getQueueFacts({ platform: "twitch", userId: "stable-rename-id" }),
    ).resolves.toMatchObject({ caller: { mapName: "Customs", gameMode: "pve" } });
    await expect(
      repo.createRequest({
        sourcePlatform: "twitch",
        sourceDeliveryId: "after-rename-duplicate",
        twitchUserId: "stable-rename-id",
        twitchLogin: "after_rename",
        gameMode: "pve",
        inGameName: "Rename PMC",
        mapId: "customs",
        objective: "Do not duplicate",
        recipientLimit: 4,
        observedAt: new Date(now.getTime() + 2),
      }),
    ).resolves.toMatchObject({ outcome: "already_active", request: { id: created.request.id } });
    const mapping = await env.DB.prepare(
      `SELECT twitch_login AS twitchLogin, twitch_user_id AS twitchUserId,
              discord_user_id AS discordUserId, in_game_name AS inGameName
       FROM user_mappings WHERE twitch_user_id = 'stable-rename-id'`,
    ).first();
    expect(mapping).toEqual({
      twitchLogin: "after_rename",
      twitchUserId: "stable-rename-id",
      discordUserId: "rename-discord",
      inGameName: "Rename PMC",
    });
    const raid = await repo.getRaid(
      Number(
        (
          await env.DB.prepare(
            `SELECT group_id AS groupId FROM raid_group_members WHERE request_id = ? AND state = 0`,
          )
            .bind(created.request.id)
            .first<{ groupId: number }>()
        )?.groupId,
      ),
    );
    expect(raid?.members[0]?.twitchLogin).toBe("after_rename");
  });

  it("merges optional identity details when the renamed login already exists", async () => {
    const repo = repository();
    await repo.upsertUserMapping({
      twitchLogin: "old_identity",
      twitchUserId: "merge-stable-id",
      discordUserId: "merge-discord",
      discordDisplayName: "Merge Discord",
      inGameName: "Merge PMC",
      observedAt: now,
    });
    await env.DB.prepare(
      `INSERT INTO user_mappings (twitch_login, created_at, updated_at)
       VALUES ('new_identity', ?, ?)`,
    )
      .bind(now.getTime(), now.getTime())
      .run();

    await repo.observeTwitchIdentity({
      twitchLogin: "new_identity",
      twitchUserId: "merge-stable-id",
      observedAt: new Date(now.getTime() + 1),
    });

    await expect(
      env.DB.prepare(
        `SELECT twitch_login AS twitchLogin, twitch_user_id AS twitchUserId,
                discord_user_id AS discordUserId, discord_display_name AS discordDisplayName,
                in_game_name AS inGameName
         FROM user_mappings ORDER BY twitch_login`,
      ).all(),
    ).resolves.toMatchObject({
      results: [
        {
          twitchLogin: "new_identity",
          twitchUserId: "merge-stable-id",
          discordUserId: "merge-discord",
          discordDisplayName: "Merge Discord",
          inGameName: "Merge PMC",
        },
      ],
    });
  });

  it("uses a known stable Twitch ID for Discord request uniqueness", async () => {
    const repo = repository();
    await repo.upsertUserMapping({
      twitchLogin: "discord_stable_viewer",
      twitchUserId: "discord-stable-id",
      discordUserId: "discord-stable-user",
      observedAt: now,
    });
    const discordRequest = await repo.createRequest({
      sourcePlatform: "discord",
      sourceDeliveryId: "discord-stable-request",
      discordUserId: "discord-stable-user",
      twitchLogin: "discord_stable_viewer",
      gameMode: "pvp",
      inGameName: "Discord Stable PMC",
      mapId: "woods",
      objective: "Discord request",
      recipientLimit: 4,
      observedAt: now,
    });

    await expect(
      repo.createRequest({
        sourcePlatform: "twitch",
        sourceDeliveryId: "discord-stable-duplicate",
        twitchUserId: "discord-stable-id",
        twitchLogin: "discord_stable_viewer",
        gameMode: "pvp",
        inGameName: "Discord Stable PMC",
        mapId: "woods",
        objective: "Twitch duplicate",
        recipientLimit: 4,
        observedAt: new Date(now.getTime() + 1),
      }),
    ).resolves.toMatchObject({
      outcome: "already_active",
      request: { id: discordRequest.request.id },
    });
    await expect(
      env.DB.prepare(
        `SELECT twitch_user_id AS twitchUserId
         FROM help_requests WHERE id = ?`,
      )
        .bind(discordRequest.request.id)
        .first(),
    ).resolves.toEqual({ twitchUserId: "discord-stable-id" });
  });

  it("updates changed generic identity details but skips an unchanged rewrite", async () => {
    const repo = repository();
    await repo.upsertUserMapping({
      twitchLogin: "linked_viewer",
      twitchUserId: "linked-twitch-id",
      discordUserId: "discord-one",
      discordDisplayName: "First name",
      inGameName: "First PMC",
      observedAt: now,
    });
    const changedAt = new Date(now.getTime() + 1);
    await expect(
      repo.upsertUserMapping({
        twitchLogin: "linked_viewer",
        twitchUserId: "linked-twitch-id",
        discordUserId: "discord-one",
        discordDisplayName: "Second name",
        inGameName: "Second PMC",
        observedAt: changedAt,
      }),
    ).resolves.toMatchObject({ discordDisplayName: "Second name", inGameName: "Second PMC" });
    const metrics = new D1Metrics();
    const measured = new D1MvpRepository(instrumentD1Database(env.DB, metrics));
    await measured.upsertUserMapping({
      twitchLogin: "linked_viewer",
      twitchUserId: "linked-twitch-id",
      discordUserId: "discord-one",
      discordDisplayName: "Second name",
      inGameName: "Second PMC",
      observedAt: new Date(now.getTime() + 2),
    });

    expect(metrics.snapshot().rowsWritten).toBe(0);
    await expect(
      env.DB.prepare(
        `SELECT updated_at AS updatedAt FROM user_mappings WHERE twitch_login = 'linked_viewer'`,
      ).first(),
    ).resolves.toEqual({ updatedAt: changedAt.getTime() });
  });
});

describe("requester pull-up", () => {
  it("pulls one requester and pushes the complete source remainder into one successor", async () => {
    const repo = repository();
    for (let index = 1; index <= 7; index += 1) await createRequest(repo, index);
    const [first, source, successor] = (await repo.getBoardSnapshot()).ordinaryRaids;
    const destination = await review(repo, first as StaffBoardRaid, "pull-destination");
    await repo.removeRequester({
      groupId: destination.id,
      requestId: destination.members[0]?.requestId as number,
      actionKey: "open-destination-seat",
      changedAt: now,
    });

    const candidates = await repo.getPullRequesterCandidates(destination.id);
    expect(candidates?.source.id).toBe(source?.id);
    const selected = candidates?.source.members[0]?.requestId as number;
    const remainder = candidates?.source.members.slice(1).map((member) => member.requestId) ?? [];
    const result = await repo.pullRequester({
      destinationGroupId: destination.id,
      sourceGroupId: candidates?.source.id as number,
      requestId: selected,
      actionKey: "pull-with-push",
      changedAt: now,
    });

    expect(result.sourceDisposition).toBe("pushed");
    expect(result.destination.members.map((member) => member.requestId)).toContain(selected);
    expect(await repo.getRaid(source?.id as number)).toMatchObject({
      state: "canceled",
      outcome: "not_run",
      members: [],
    });
    expect(
      (await repo.getRaid(successor?.id as number))?.members.map((member) => member.requestId),
    ).toEqual([successor?.members[0]?.requestId, ...remainder]);
    const history = await env.DB.prepare(
      `SELECT group_id AS groupId, request_id AS requestId, state
       FROM raid_group_members
       WHERE request_id IN (${[selected, ...remainder].map(() => "?").join(",")})
       ORDER BY request_id, id`,
    )
      .bind(selected, ...remainder)
      .all<{ groupId: number; requestId: number; state: number }>();
    expect(history.results.filter((member) => member.state === 2)).toHaveLength(3);
    expect(history.results.filter((member) => member.state === 0)).toHaveLength(3);
  });

  it("keeps pull and push bounded with 10,000 removed source memberships", async () => {
    const repo = repository();
    for (let index = 1; index <= 7; index += 1) await createRequest(repo, index);
    const [first, source] = (await repo.getBoardSnapshot()).ordinaryRaids;
    const destination = await review(repo, first as StaffBoardRaid, "history-pull-destination");
    await repo.removeRequester({
      groupId: destination.id,
      requestId: destination.members[0]?.requestId as number,
      actionKey: "history-open-destination",
      changedAt: now,
    });
    await seedWaitingRequests(10_000, { offset: 200_000 });
    await env.DB.prepare(
      `UPDATE help_requests SET state = 3
       WHERE source_delivery_id LIKE 'bulk-delivery-%'`,
    ).run();
    await env.DB.prepare(
      `INSERT INTO raid_group_members
         (group_id, request_id, position, state, created_at, updated_at)
       SELECT ?, id, id + 100, 2, ?, ? FROM help_requests
       WHERE source_delivery_id LIKE 'bulk-delivery-%'`,
    )
      .bind(source?.id, now.getTime() - 1, now.getTime() - 1)
      .run();
    const selected = source?.members[0]?.requestId as number;
    const metrics = new D1Metrics(true);
    const measured = new D1MvpRepository(instrumentD1Database(env.DB, metrics));

    const result = await measured.pullRequester({
      destinationGroupId: destination.id,
      sourceGroupId: source?.id as number,
      requestId: selected,
      actionKey: "history-pull",
      changedAt: now,
    });

    expect(result.destination.members.map((member) => member.requestId)).toContain(selected);
    expect(
      metrics.snapshot().rowsRead,
      JSON.stringify(metrics.statementDetails(), null, 2),
    ).toBeLessThan(300);
  }, 20_000);

  it("retains the complete source party when the immediate successor cannot fit it", async () => {
    const repo = repository();
    for (let index = 1; index <= 8; index += 1) await createRequest(repo, index);
    const [first, source, successor] = (await repo.getBoardSnapshot()).ordinaryRaids;
    const destination = await review(repo, first as StaffBoardRaid, "retained-destination");
    await repo.removeRequester({
      groupId: destination.id,
      requestId: destination.members[0]?.requestId as number,
      actionKey: "retained-open-seat",
      changedAt: now,
    });
    const selected = source?.members[0]?.requestId as number;
    const sourceRemainder = source?.members.slice(1).map((member) => member.requestId) ?? [];
    const successorMembers = successor?.members.map((member) => member.requestId) ?? [];

    const result = await repo.pullRequester({
      destinationGroupId: destination.id,
      sourceGroupId: source?.id as number,
      requestId: selected,
      actionKey: "pull-retained",
      changedAt: now,
    });

    expect(result.sourceDisposition).toBe("retained");
    expect(
      (await repo.getRaid(source?.id as number))?.members.map((member) => member.requestId),
    ).toEqual(sourceRemainder);
    expect(
      (await repo.getRaid(successor?.id as number))?.members.map((member) => member.requestId),
    ).toEqual(successorMembers);
  });

  it("promotes only the selected Ordinary requester into a reviewed Priority raid", async () => {
    const repo = repository();
    await createRequest(repo, 1);
    await createRequest(repo, 2);
    const ordinary = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    const active = await start(repo, ordinary);
    const priority = await repo.postponeRaid({
      groupId: active.id,
      actionKey: "make-priority-destination",
      changedAt: now,
    });
    const destination = await review(repo, priority, "priority-pull-destination");
    for (let index = 3; index <= 6; index += 1) await createRequest(repo, index);
    const candidates = await repo.getPullRequesterCandidates(destination.id);
    const selected = candidates?.source.members[0]?.requestId as number;
    const unselected = candidates?.source.members.slice(1).map((member) => member.requestId) ?? [];

    const result = await repo.pullRequester({
      destinationGroupId: destination.id,
      sourceGroupId: candidates?.source.id as number,
      requestId: selected,
      actionKey: "pull-ordinary-into-priority",
      changedAt: now,
    });

    expect(result.destination.queueKind).toBe("priority");
    expect(result.sourceDisposition).toBe("pushed");
    const priorities = await env.DB.prepare(
      `SELECT id, is_priority AS isPriority FROM help_requests
       WHERE id IN (${[selected, ...unselected].map(() => "?").join(",")}) ORDER BY id`,
    )
      .bind(selected, ...unselected)
      .all<{ id: number; isPriority: number }>();
    expect(priorities.results.find((request) => request.id === selected)?.isPriority).toBe(1);
    expect(
      priorities.results
        .filter((request) => unselected.includes(request.id))
        .map((request) => request.isPriority),
    ).toEqual(unselected.map(() => 0));
  });

  it("never pulls a requester from a concurrent volunteer-led active raid", async () => {
    const repo = repository();
    for (let index = 1; index <= 7; index += 1) await createRequest(repo, index);
    const [first, volunteerRaid, later] = (await repo.getBoardSnapshot()).ordinaryRaids;
    const active = await start(repo, volunteerRaid as StaffBoardRaid);
    const activeRequestIds = active.members.map((member) => member.requestId);
    const reviewed = await review(repo, first as StaffBoardRaid, "streamer-reviewed-destination");
    await repo.removeRequester({
      groupId: reviewed.id,
      requestId: reviewed.members[0]?.requestId as number,
      actionKey: "streamer-opens-seat",
      changedAt: now,
    });

    const candidates = await repo.getPullRequesterCandidates(reviewed.id);
    expect(candidates?.source.id).toBe(later?.id);
    expect(candidates?.source.members.map((member) => member.requestId)).not.toEqual(
      expect.arrayContaining(activeRequestIds),
    );
    await repo.pullRequester({
      destinationGroupId: reviewed.id,
      sourceGroupId: candidates?.source.id as number,
      requestId: candidates?.source.members[0]?.requestId as number,
      actionKey: "streamer-pulls-past-active",
      changedAt: now,
    });
    expect((await repo.getRaid(active.id))?.members.map((member) => member.requestId)).toEqual(
      activeRequestIds,
    );
    expect((await repo.getRaid(active.id))?.state).toBe("active");
  });

  it("rejects a stale source selection without moving any requester", async () => {
    const repo = repository();
    for (let index = 1; index <= 4; index += 1) await createRequest(repo, index);
    const [first] = (await repo.getBoardSnapshot()).ordinaryRaids;
    const reviewed = await review(repo, first as StaffBoardRaid, "stale-pull-destination");
    await repo.removeRequester({
      groupId: reviewed.id,
      requestId: reviewed.members[0]?.requestId as number,
      actionKey: "stale-open-seat",
      changedAt: now,
    });
    const candidates = await repo.getPullRequesterCandidates(reviewed.id);
    const sourceBefore = candidates?.source.members.map((member) => member.requestId) ?? [];
    await start(repo, candidates?.source as StaffBoardRaid);

    await expect(
      repo.pullRequester({
        destinationGroupId: reviewed.id,
        sourceGroupId: candidates?.source.id as number,
        requestId: candidates?.source.members[0]?.requestId as number,
        actionKey: "stale-pull",
        changedAt: now,
      }),
    ).rejects.toThrow("out of date");
    expect((await repo.getRaid(reviewed.id))?.members).toHaveLength(2);
    expect(
      (await repo.getRaid(candidates?.source.id as number))?.members.map(
        (member) => member.requestId,
      ),
    ).toEqual(sourceBefore);
  });

  it.each(TARKOV_MAPS)("enforces $name requester capacity during a pull", async (map) => {
    const repo = repository();
    const requesterCapacity = map.sherpaPartyCapacity - 1;
    for (let index = 1; index <= requesterCapacity + 1; index += 1) {
      await createRequest(repo, index, map.id, "pve", 99);
    }
    const [first, source] = (await repo.getBoardSnapshot()).ordinaryRaids;
    const reviewed = await review(repo, first as StaffBoardRaid, "icebreaker-pull");
    await repo.removeRequester({
      groupId: reviewed.id,
      requestId: reviewed.members[0]?.requestId as number,
      actionKey: "icebreaker-open-seat",
      changedAt: now,
    });
    const result = await repo.pullRequester({
      destinationGroupId: reviewed.id,
      sourceGroupId: source?.id as number,
      requestId: source?.members[0]?.requestId as number,
      actionKey: "icebreaker-pull-requester",
      changedAt: now,
    });
    expect(result.destination.members).toHaveLength(requesterCapacity);
    expect(result.destination.requesterCapacity).toBe(requesterCapacity);
    await expect(currentMemberCount(result.destination.id)).resolves.toBe(requesterCapacity);
  });

  it("skips different modes and maps before selecting the first compatible source", async () => {
    const repo = repository();
    for (let index = 1; index <= 3; index += 1) {
      await createRequest(repo, index, "customs", "pve");
    }
    for (let index = 4; index <= 6; index += 1) {
      await createRequest(repo, index, "customs", "pvp");
    }
    for (let index = 7; index <= 9; index += 1) {
      await createRequest(repo, index, "woods", "pve");
    }
    const compatibleRequest = await createRequest(repo, 10, "customs", "pve");
    const destinationSeed = (await repo.getBoardSnapshot()).ordinaryRaids.find(
      (raid) => raid.gameMode === "pve" && raid.mapId === "customs",
    ) as StaffBoardRaid;
    const destination = await review(repo, destinationSeed, "compatibility-pull-destination");
    await repo.removeRequester({
      groupId: destination.id,
      requestId: destination.members[0]?.requestId as number,
      actionKey: "compatibility-open-seat",
      changedAt: now,
    });

    const candidates = await repo.getPullRequesterCandidates(destination.id);
    expect(candidates?.source).toMatchObject({ gameMode: "pve", mapId: "customs" });
    expect(candidates?.source.members.map((member) => member.requestId)).toEqual([
      compatibleRequest,
    ]);
  });

  it("uses a later Priority source before an Ordinary source", async () => {
    const repo = repository();
    for (let index = 1; index <= 9; index += 1) await createRequest(repo, index);
    const [first, second, ordinarySource] = (await repo.getBoardSnapshot()).ordinaryRaids;
    await postpone(repo, first as StaffBoardRaid, "first-priority-pull-raid");
    await postpone(repo, second as StaffBoardRaid, "second-priority-pull-raid");
    const priorityRaids = (await repo.getBoardSnapshot()).priorityRaids;
    await env.DB.prepare(
      `UPDATE raid_groups SET automatic_fill = 1,
              leader_discord_user_id = NULL, leader_type = NULL
       WHERE id = ?`,
    )
      .bind(priorityRaids[1]?.id)
      .run();
    const destination = await review(
      repo,
      priorityRaids[0] as StaffBoardRaid,
      "priority-source-destination",
    );
    await repo.removeRequester({
      groupId: destination.id,
      requestId: destination.members[0]?.requestId as number,
      actionKey: "priority-source-open-seat",
      changedAt: now,
    });

    const candidates = await repo.getPullRequesterCandidates(destination.id);
    expect(candidates?.source.id).toBe(priorityRaids[1]?.id);
    expect(candidates?.source.id).not.toBe(ordinarySource?.id);
    expect(candidates?.source.queueKind).toBe("priority");
  });

  it("never offers a Priority source to an Ordinary destination", async () => {
    const repo = repository();
    for (let index = 1; index <= 9; index += 1) await createRequest(repo, index);
    const [prioritySeed, ordinaryDestinationSeed, ordinarySource] = (await repo.getBoardSnapshot())
      .ordinaryRaids;
    await postpone(repo, prioritySeed as StaffBoardRaid, "priority-before-ordinary-pull");
    const priority = (await repo.getBoardSnapshot()).priorityRaids[0] as StaffBoardRaid;
    const destination = await review(
      repo,
      ordinaryDestinationSeed as StaffBoardRaid,
      "ordinary-pull-destination",
    );
    await repo.removeRequester({
      groupId: destination.id,
      requestId: destination.members[0]?.requestId as number,
      actionKey: "ordinary-pull-open-seat",
      changedAt: now,
    });

    const candidates = await repo.getPullRequesterCandidates(destination.id);
    expect(candidates?.source.id).toBe(ordinarySource?.id);
    expect(candidates?.source.id).not.toBe(priority.id);
    expect(candidates?.source.queueKind).toBe("ordinary");
  });

  it("stops push-down at a reviewed compatible boundary", async () => {
    const repo = repository();
    for (let index = 1; index <= 10; index += 1) await createRequest(repo, index);
    const [first, source, boundary, farther] = (await repo.getBoardSnapshot()).ordinaryRaids;
    const frozenBoundary = await review(repo, boundary as StaffBoardRaid, "frozen-push-boundary");
    const destination = await review(repo, first as StaffBoardRaid, "bounded-push-destination");
    await repo.removeRequester({
      groupId: destination.id,
      requestId: destination.members[0]?.requestId as number,
      actionKey: "bounded-push-open-seat",
      changedAt: now,
    });
    const sourceRemainder = source?.members.slice(1).map((member) => member.requestId) ?? [];
    const fartherMembers = farther?.members.map((member) => member.requestId) ?? [];

    const result = await repo.pullRequester({
      destinationGroupId: destination.id,
      sourceGroupId: source?.id as number,
      requestId: source?.members[0]?.requestId as number,
      actionKey: "bounded-push-pull",
      changedAt: now,
    });
    expect(result.sourceDisposition).toBe("retained");
    expect(
      (await repo.getRaid(source?.id as number))?.members.map((member) => member.requestId),
    ).toEqual(sourceRemainder);
    expect(await repo.getRaid(frozenBoundary.id)).toMatchObject({
      automaticFill: false,
      staffMessageId: "frozen-push-boundary",
    });
    expect(
      (await repo.getRaid(farther?.id as number))?.members.map((member) => member.requestId),
    ).toEqual(fartherMembers);
  });

  it("does not offer a reviewed or leader-reserved source", async () => {
    const repo = repository();
    for (let index = 1; index <= 4; index += 1) await createRequest(repo, index);
    const [first, source] = (await repo.getBoardSnapshot()).ordinaryRaids;
    await review(repo, source as StaffBoardRaid, "reviewed-source-boundary");
    const destination = await review(repo, first as StaffBoardRaid, "reviewed-source-destination");
    await repo.removeRequester({
      groupId: destination.id,
      requestId: destination.members[0]?.requestId as number,
      actionKey: "reviewed-source-open-seat",
      changedAt: now,
    });
    await expect(repo.getPullRequesterCandidates(destination.id)).resolves.toBeUndefined();

    await env.DB.prepare(
      `UPDATE raid_groups SET automatic_fill = 1, staff_message_id = NULL,
              leader_discord_user_id = 'reserved-volunteer', leader_type = 1
       WHERE id = ?`,
    )
      .bind(source?.id)
      .run();
    await expect(repo.getPullRequesterCandidates(destination.id)).resolves.toBeUndefined();
  });

  it("rolls back the complete pull when a push membership write fails", async () => {
    const repo = repository();
    for (let index = 1; index <= 8; index += 1) await createRequest(repo, index);
    const [first, source, target] = (await repo.getBoardSnapshot()).ordinaryRaids;
    const destination = await review(repo, first as StaffBoardRaid, "rollback-pull-destination");
    await repo.removeRequester({
      groupId: destination.id,
      requestId: destination.members[0]?.requestId as number,
      actionKey: "rollback-open-seat",
      changedAt: now,
    });
    const destinationBefore = (await repo.getRaid(destination.id))?.members.map(
      (member) => member.requestId,
    );
    const sourceBefore = source?.members.map((member) => member.requestId) ?? [];
    const targetBefore = target?.members.map((member) => member.requestId) ?? [];
    await env.DB.prepare(
      `CREATE TRIGGER test_fail_pull_push
       BEFORE INSERT ON raid_group_members
       WHEN NEW.group_id = ${String(destination.id)}
       BEGIN
         SELECT RAISE(ABORT, 'simulated pull failure');
       END`,
    ).run();

    try {
      await expect(
        repo.pullRequester({
          destinationGroupId: destination.id,
          sourceGroupId: source?.id as number,
          requestId: source?.members[0]?.requestId as number,
          actionKey: "rollback-failing-push",
          changedAt: now,
        }),
      ).rejects.toThrow("out of date");
    } finally {
      await env.DB.prepare("DROP TRIGGER test_fail_pull_push").run();
    }
    expect((await repo.getRaid(destination.id))?.members.map((member) => member.requestId)).toEqual(
      destinationBefore,
    );
    expect(
      (await repo.getRaid(source?.id as number))?.members.map((member) => member.requestId),
    ).toEqual(sourceBefore);
    expect(
      (await repo.getRaid(target?.id as number))?.members.map((member) => member.requestId),
    ).toEqual(targetBefore);
    const selectedOpenMemberships = await env.DB.prepare(
      `SELECT count(*) AS count FROM raid_group_members
       WHERE request_id = ? AND state = 0`,
    )
      .bind(source?.members[0]?.requestId)
      .first<{ count: number }>();
    expect(selectedOpenMemberships?.count).toBe(1);
  });

  it("allows only one concurrent pull of the same requester", async () => {
    const repo = repository();
    for (let index = 1; index <= 4; index += 1) await createRequest(repo, index);
    const [first, source] = (await repo.getBoardSnapshot()).ordinaryRaids;
    const reviewed = await review(repo, first as StaffBoardRaid, "concurrent-pull-destination");
    await repo.removeRequester({
      groupId: reviewed.id,
      requestId: reviewed.members[0]?.requestId as number,
      actionKey: "concurrent-open-seat",
      changedAt: now,
    });
    const selected = source?.members[0]?.requestId as number;
    const pulls = await Promise.allSettled(
      ["concurrent-pull-one", "concurrent-pull-two"].map((actionKey) =>
        repo.pullRequester({
          destinationGroupId: reviewed.id,
          sourceGroupId: source?.id as number,
          requestId: selected,
          actionKey,
          changedAt: now,
        }),
      ),
    );
    expect(pulls.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(pulls.filter((result) => result.status === "rejected")).toHaveLength(1);
    const openMemberships = await env.DB.prepare(
      `SELECT count(*) AS count FROM raid_group_members WHERE request_id = ? AND state = 0`,
    )
      .bind(selected)
      .first<{ count: number }>();
    expect(openMemberships?.count).toBe(1);
  });
});
