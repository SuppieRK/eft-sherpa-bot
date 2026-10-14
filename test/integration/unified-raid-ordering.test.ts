import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { TARKOV_MAPS } from "../../src/domain/maps/catalog";
import { D1Metrics, instrumentD1Database } from "../../src/infrastructure/cloudflare/d1-metrics";
import { D1MvpRepository } from "../../src/infrastructure/cloudflare/d1-mvp-repository";
import { postponedRaid } from "../fixtures/raid-transitions";

const now = new Date("2096-10-14T12:00:00Z");
const messageId = "700000000000000000";

async function create(repo: D1MvpRepository, index: number, mapId = "customs", recipientLimit = 1) {
  await repo.createRequest({
    sourcePlatform: "twitch",
    sourceDeliveryId: `unified-${index}`,
    twitchUserId: `unified-user-${index}`,
    twitchLogin: `unified_${index}`,
    gameMode: "pve",
    inGameName: `Player ${index}`,
    mapId,
    objective: `Goal ${index}`,
    recipientLimit,
    observedAt: new Date(now.getTime() + index),
  });
}

async function board(repo: D1MvpRepository) {
  await env.DB.prepare(
    `UPDATE community_state SET staff_board_message_id = ? WHERE community_id='butcoffee'`,
  )
    .bind(messageId)
    .run();
  return repo.getBoardSnapshot();
}

async function placement(repo: D1MvpRepository, groupId: number, remove = false) {
  const snapshot = await repo.getBoardSnapshot();
  return repo.changeRaidPlacement({
    groupId,
    remove,
    expectedVersion: snapshot.boardVersion ?? 0,
    expectedMessageId: messageId,
    actionKey: `placement-${snapshot.boardVersion}`,
    changedAt: now,
  });
}

async function start(repo: D1MvpRepository, groupId: number) {
  await repo.reviewRaid({ groupId, changedAt: now });
  await repo.setRaidStaffMessage(groupId, `details-${groupId}`, now);
  return repo.startRaid({
    groupId,
    leaderDiscordUserId: "900000000000000000",
    leaderType: "streamer",
    requestTwitchCall: true,
    changedAt: now,
  });
}

it("moves and reverses planned raids and updates viewer positions without moving members", async () => {
  const repo = new D1MvpRepository(env.DB);
  for (let i = 1; i <= 3; i++) await create(repo, i);
  const initial = await board(repo);
  const before = (await env.DB.prepare("SELECT * FROM raid_group_members ORDER BY id").all())
    .results;
  expect(await placement(repo, 3)).toBe(true);
  expect(await placement(repo, 2)).toBe(true);
  expect((await repo.getBoardSnapshot()).raids.map((raid) => raid.id)).toEqual([2, 3, 1]);
  expect(
    (await repo.getQueueFacts({ platform: "twitch", userId: "unified-user-2" })).caller,
  ).toMatchObject({
    queuePosition: { kind: "exact", ordinal: 1 },
    raidsAhead: { kind: "exact", count: 0 },
  });
  expect(
    (await repo.getQueueFacts({ platform: "twitch", userId: "unified-user-1" })).caller,
  ).toMatchObject({
    queuePosition: { kind: "exact", ordinal: 3 },
    raidsAhead: { kind: "exact", count: 2 },
  });
  expect(await placement(repo, 3, true)).toBe(true);
  expect((await repo.getBoardSnapshot()).raids.map((raid) => raid.id)).toEqual([2, 1, 3]);
  expect(
    (await env.DB.prepare("SELECT * FROM raid_group_members ORDER BY id").all()).results,
  ).toEqual(before);
  const version = (await repo.getBoardSnapshot()).boardVersion;
  expect(await placement(repo, 3, true)).toBe(false);
  expect((await repo.getBoardSnapshot()).boardVersion).toBe(version);
  expect(
    await repo.changeRaidPlacement({
      groupId: 1,
      remove: false,
      expectedVersion: initial.boardVersion ?? 0,
      expectedMessageId: messageId,
      actionKey: "stale-move",
      changedAt: now,
    }),
  ).toBe(false);
  const active = await start(repo, 1);
  expect(active).not.toHaveProperty("attemptCount");
  expect(active).not.toHaveProperty("queueKind");
  expect(await placement(repo, 1)).toBe(false);
  expect((await repo.getBoardSnapshot()).raids[0]?.id).toBe(1);
});

it("pages in both directions and resets on data updates while rejecting stale navigation", async () => {
  const repo = new D1MvpRepository(env.DB);
  for (let i = 1; i <= 23; i++) await create(repo, i);
  let snapshot = await board(repo);
  expect(snapshot.raids.map((raid) => raid.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const first = snapshot;
  if (snapshot.nextPage === undefined) throw new Error("Missing next page");
  expect(
    await repo.navigateBoard({
      target: snapshot.nextPage,
      expectedVersion: snapshot.boardVersion ?? 0,
      expectedMessageId: messageId,
      changedAt: now,
    }),
  ).toBe(true);
  snapshot = await repo.getBoardSnapshot();
  expect(snapshot.pageNumber).toBe(2);
  expect(snapshot.raids.map((raid) => raid.id)).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
  if (snapshot.previousPage === undefined) throw new Error("Missing previous page");
  expect(
    await repo.navigateBoard({
      target: snapshot.previousPage,
      expectedVersion: snapshot.boardVersion ?? 0,
      expectedMessageId: messageId,
      changedAt: now,
    }),
  ).toBe(true);
  snapshot = await repo.getBoardSnapshot();
  expect(snapshot.pageNumber).toBe(1);
  expect(snapshot.previousPage).toBeUndefined();
  for (let i = 0; i < 2; i++) {
    if (snapshot.nextPage === undefined) throw new Error("Missing next page");
    await repo.navigateBoard({
      target: snapshot.nextPage,
      expectedVersion: snapshot.boardVersion ?? 0,
      expectedMessageId: messageId,
      changedAt: now,
    });
    snapshot = await repo.getBoardSnapshot();
  }
  expect(snapshot.pageNumber).toBe(3);
  expect(snapshot.raids.map((raid) => raid.id)).toEqual([21, 22, 23]);
  expect(snapshot.nextPage).toBeUndefined();
  await create(repo, 24);
  snapshot = await repo.getBoardSnapshot();
  expect(snapshot.pageNumber).toBe(1);
  expect(snapshot.raidCount).toBe(24);
  if (first.nextPage === undefined) throw new Error("Missing stale target");
  expect(
    await repo.navigateBoard({
      target: first.nextPage,
      expectedVersion: first.boardVersion ?? 0,
      expectedMessageId: messageId,
      changedAt: now,
    }),
  ).toBe(false);
  expect((await repo.getBoardSnapshot()).pageNumber).toBe(1);
});

it("keeps automatic filling until review and postpones the same party at the unified tail", async () => {
  const repo = new D1MvpRepository(env.DB);
  await create(repo, 1, "woods", 3);
  await create(repo, 2, "customs", 3);
  await board(repo);
  await placement(repo, 2);
  await create(repo, 3, "customs", 3);
  expect((await repo.getRaid(2))?.members.map((member) => member.requestId)).toEqual([2, 3]);
  expect((await repo.getRaid(2))?.manualOrder).toBeGreaterThan(0);
  await repo.reviewRaid({ groupId: 2, changedAt: now });
  await create(repo, 4, "customs", 3);
  expect((await repo.getRaid(2))?.members.map((member) => member.requestId)).toEqual([2, 3]);
  const active = await start(repo, 2);
  expect(active.manualOrder).toBe(0);
  const calls = { discord: active.discordCallStatus, twitch: active.twitchCallStatus };
  await postponedRaid(repo, { groupId: 2, actionKey: "postpone", changedAt: now });
  const postponed = await repo.getRaid(2);
  expect(postponed).toMatchObject({
    state: "planned",
    manualOrder: 0,
    leaderDiscordUserId: "900000000000000000",
    discordCallStatus: "not_requested",
    twitchCallStatus: "not_requested",
  });
  expect(postponed?.members.map((member) => member.requestId)).toEqual([2, 3]);
  expect((await repo.getBoardSnapshot()).raids.at(-1)?.id).toBe(2);
  expect(calls).toEqual({ discord: "pending", twitch: "pending" });
});

it("uses indexes for global pages and mode-scoped requester prefixes", async () => {
  for (const [sql, index] of [
    [
      "SELECT id FROM raid_groups WHERE state IN (0,1) AND (service_lane,service_key,id) > (1,100000000,100) ORDER BY service_lane,service_key,id LIMIT 11",
      "raid_groups_service_order_idx",
    ],
    [
      "SELECT current_member_count FROM raid_groups WHERE state IN (0,1) AND game_mode=2 AND (service_lane,service_key,id) < (1,100000000,100) ORDER BY service_lane,service_key,id LIMIT 101",
      "raid_groups_mode_service_order_idx",
    ],
  ]) {
    const plan = (
      await env.DB.prepare(`EXPLAIN QUERY PLAN ${sql}`).all<{ detail: string }>()
    ).results
      .map((row) => row.detail)
      .join("\n");
    expect(plan).toContain(index);
    expect(plan).not.toContain("TEMP B-TREE");
  }
});

it("repairs eighty requests across every mode and map in one bounded pass", async () => {
  const buckets = [0, 1, 2].flatMap((gameMode) =>
    TARKOV_MAPS.map((map) => ({ gameMode, mapId: map.id })),
  );
  const rows = Array.from({ length: 81 }, (_, index) => ({
    id: index + 1,
    ...buckets[index % buckets.length],
  }));
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO user_mappings (twitch_login,created_at,updated_at)
      SELECT printf('repair_%d',json_extract(value,'$.id')),1,1 FROM json_each(?)`).bind(
      JSON.stringify(rows),
    ),
    env.DB.prepare(`INSERT INTO help_requests (source_platform,source_delivery_id,twitch_user_id,twitch_login,in_game_name,game_mode,map_id,objective,created_at,updated_at)
      SELECT 1,printf('repair-%d',json_extract(value,'$.id')),printf('repair-user-%d',json_extract(value,'$.id')),printf('repair_%d',json_extract(value,'$.id')),'PMC',
      json_extract(value,'$.gameMode'),json_extract(value,'$.mapId'),'Goal',1,1 FROM json_each(?)`).bind(
      JSON.stringify(rows),
    ),
  ]);
  const repo = new D1MvpRepository(env.DB);
  expect(await repo.repairLegacyUnassignedRequests({ recipientLimit: 4, changedAt: now })).toEqual({
    repaired: 80,
    hasMore: true,
  });
});

it("bounds complete first and deep page reads without scanning inactive branches", async () => {
  const rows = JSON.stringify(Array.from({ length: 1000 }, (_, index) => index + 1));
  await env.DB.batch([
    env.DB.prepare(
      "INSERT INTO community_state (community_id,created_at,updated_at) VALUES ('butcoffee',1,1)",
    ),
    env.DB.prepare(`INSERT INTO user_mappings (twitch_login,twitch_user_id,created_at,updated_at)
      SELECT printf('page_%d',value),printf('page-user-%d',value),1,1 FROM json_each(?)`).bind(
      rows,
    ),
    env.DB.prepare(`INSERT INTO help_requests (id,source_platform,source_delivery_id,twitch_login,twitch_user_id,in_game_name,map_id,objective,state,created_at,updated_at)
      SELECT value,1,printf('page-%d',value),printf('page_%d',value),printf('page-user-%d',value),'PMC','customs','Goal',1,1,1 FROM json_each(?)`).bind(
      rows,
    ),
    env.DB.prepare(`INSERT INTO raid_groups (id,sort_key,map_id,requester_capacity,created_at,updated_at)
      SELECT value,value*1000000,'customs',1,1,1 FROM json_each(?)`).bind(rows),
    env.DB.prepare(`INSERT INTO raid_group_members (group_id,request_id,position,created_at,updated_at)
      SELECT value,value,1,1,1 FROM json_each(?)`).bind(rows),
  ]);
  for (const [direction, boundary, pageNumber, firstId] of [
    [0, 0, 1, 1],
    [1, 990, 100, 991],
    [-1, 991, 99, 981],
  ]) {
    await env.DB.prepare(
      `UPDATE community_state SET board_page_direction=?,board_page_lane=1,board_page_key=?,board_page_id=?,board_page_number=?`,
    )
      .bind(direction, (boundary ?? 0) * 1000000, boundary, pageNumber)
      .run();
    const metrics = new D1Metrics(true);
    let pageSql = "";
    const tracing = new Proxy(env.DB, {
      get(database, key) {
        if (key === "prepare")
          return (sql: string) => {
            if (sql.includes("d1:board.page")) pageSql = sql;
            return database.prepare(sql);
          };
        const value = Reflect.get(database, key);
        return typeof value === "function" ? value.bind(database) : value;
      },
    });
    const snapshot = await new D1MvpRepository(
      instrumentD1Database(tracing, metrics),
    ).getBoardSnapshot();
    const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${pageSql}`).all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join("\n");
    expect(details).toContain("raid_groups_service_order_idx");
    if (direction !== 0) expect(details).toContain("service_lane=? AND service_key");
    expect(snapshot.raids[0]?.id).toBe(firstId);
    expect(snapshot.raids).toHaveLength(10);
    expect(metrics.snapshot().bindingCalls).toBe(2);
    expect(metrics.snapshot().statements).toBe(3);
    expect(
      metrics.snapshot().rowsRead,
      JSON.stringify({ direction, statements: metrics.statementDetails(), plan: plan.results }),
    ).toBeLessThan(150);
    expect(
      metrics.statementDetails().find((statement) => statement.queryId === "board.page")?.rowsRead,
    ).toBeLessThan(60);
  }
  const queueMetrics = new D1Metrics(true);
  const facts = await new D1MvpRepository(instrumentD1Database(env.DB, queueMetrics)).getQueueFacts(
    { platform: "twitch", userId: "page-user-1000" },
  );
  expect(facts.caller).toMatchObject({
    queuePosition: { kind: "more_than", requestsAhead: 100 },
    raidsAhead: { kind: "more_than", count: 50 },
  });
  expect(
    queueMetrics.snapshot().rowsRead,
    JSON.stringify(queueMetrics.statementDetails()),
  ).toBeLessThan(180);
});

it("pages across active, pinned, and normal raids in both directions", async () => {
  const repo = new D1MvpRepository(env.DB);
  for (let index = 1; index <= 33; index++) await create(repo, index);
  await board(repo);
  for (let id = 1; id <= 14; id++) await start(repo, id);
  for (const id of [20, 21, 22]) await placement(repo, id);
  let snapshot = await repo.getBoardSnapshot();
  const navigate = async (target: typeof snapshot.nextPage) => {
    if (target === undefined) throw new Error("Missing page target");
    expect(
      await repo.navigateBoard({
        target,
        expectedVersion: snapshot.boardVersion ?? 0,
        expectedMessageId: messageId,
        changedAt: now,
      }),
    ).toBe(true);
    snapshot = await repo.getBoardSnapshot();
  };
  expect(snapshot.raids.map((raid) => raid.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  await navigate(snapshot.nextPage);
  expect(snapshot.raids.map((raid) => raid.id)).toEqual([11, 12, 13, 14, 22, 21, 20, 15, 16, 17]);
  await navigate(snapshot.nextPage);
  expect(snapshot.raids.map((raid) => raid.id)).toEqual([18, 19, 23, 24, 25, 26, 27, 28, 29, 30]);
  await navigate(snapshot.previousPage);
  expect(snapshot.raids.map((raid) => raid.id)).toEqual([11, 12, 13, 14, 22, 21, 20, 15, 16, 17]);
  await navigate(snapshot.previousPage);
  expect(snapshot.pageNumber).toBe(1);
  expect(snapshot.raids.map((raid) => raid.id)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});
