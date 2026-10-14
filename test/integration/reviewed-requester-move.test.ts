import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { D1Metrics, instrumentD1Database } from "../../src/infrastructure/cloudflare/d1-metrics";
import { D1MvpRepository } from "../../src/infrastructure/cloudflare/d1-mvp-repository";

const at = new Date("2096-10-14T12:00:00Z");

async function request(
  repo: D1MvpRepository,
  id: string,
  mapId = "the-lab",
  mode: "pve" | "pvp" = "pve",
  capacity = 4,
) {
  return repo.createRequest({
    sourcePlatform: "twitch",
    sourceDeliveryId: id,
    twitchUserId: id,
    twitchLogin: id.replaceAll("-", "_"),
    gameMode: mode,
    mapId,
    inGameName: "Test PMC",
    objective: "Test goal",
    recipientLimit: capacity,
    observedAt: at,
  });
}

async function fixture(count = 2) {
  const repo = new D1MvpRepository(env.DB);
  for (let index = 0; index < count; index++) await request(repo, `source-${index}`);
  const source = (await repo.getBoardSnapshot()).raids[0];
  if (source === undefined) throw new Error("Missing source");
  await repo.reviewRaid({ groupId: source.id, changedAt: at });
  await repo.setRaidStaffMessage(source.id, "review-message", at);
  return { repo, source };
}

function move(repo: D1MvpRepository, source: Awaited<ReturnType<typeof fixture>>["source"]) {
  const requestId = source.members[0]?.requestId;
  if (requestId === undefined) throw new Error("Missing requester");
  return repo.postponeRequester({
    groupId: source.id,
    requestId,
    actionKey: "reviewed-move",
    changedAt: at,
  });
}

function beforeBatch(action: () => Promise<void>): D1Database {
  let pending = true;
  return new Proxy(env.DB, {
    get(db, key) {
      if (key === "batch")
        return async (statements: D1PreparedStatement[]) => {
          if (pending) {
            pending = false;
            await action();
          }
          return db.batch(statements);
        };
      const value = Reflect.get(db, key);
      return typeof value === "function" ? value.bind(db) : value;
    },
  });
}

it("moves to an existing destination beyond the board page without creating a raid", async () => {
  const { repo, source } = await fixture();
  for (let index = 0; index < 12; index++)
    await request(repo, `other-${index}`, "customs", "pve", 1);
  const existing = await request(repo, "destination");
  const destination = await env.DB.prepare(
    "SELECT group_id AS id FROM raid_group_members WHERE request_id=? AND state=0",
  )
    .bind(existing.request.id)
    .first<{ id: number }>();
  if (destination === null) throw new Error("Missing destination");
  await env.DB.prepare(
    "UPDATE raid_groups SET leader_discord_user_id='reserved-target',leader_type=0 WHERE id=?",
  )
    .bind(destination.id)
    .run();
  expect((await repo.getBoardSnapshot()).raids.some((raid) => raid.id === destination.id)).toBe(
    false,
  );
  expect((await repo.getRaid(source.id))?.nextMoveRaidId).toBe(destination.id);
  const metrics = new D1Metrics();
  const moved = await move(new D1MvpRepository(instrumentD1Database(env.DB, metrics)), source);
  expect(moved.dedicated.id).toBe(destination.id);
  expect(moved.dedicated.leaderDiscordUserId).toBe("reserved-target");
  expect(moved.source.members).toHaveLength(1);
  expect(moved.source).toMatchObject({
    state: "planned",
    automaticFill: false,
    staffMessageId: "review-message",
    discordCallStatus: "not_requested",
    twitchCallStatus: "not_requested",
  });
  expect(moved.dedicated.members.map((member) => member.requestId)).toEqual([
    existing.request.id,
    source.members[0]?.requestId,
  ]);
  expect(await env.DB.prepare("SELECT count(*) AS count FROM raid_groups").first()).toEqual({
    count: 14,
  });
  expect(metrics.snapshot().bindingCalls).toBe(7);
  expect(metrics.snapshot().rowsRead).toBeLessThan(100);
});

it("closes a sole-requester source while retaining the existing destination and request", async () => {
  const { repo, source } = await fixture(1);
  const existing = await request(repo, "destination");
  const moved = await move(repo, source);
  expect(moved.source).toMatchObject({ state: "canceled", outcome: "not_run" });
  expect(moved.source.staffMessageId).toBeUndefined();
  expect(moved.dedicated.members.map((member) => member.requestId)).toEqual([
    existing.request.id,
    source.members[0]?.requestId,
  ]);
  expect(await env.DB.prepare("SELECT count(*) AS count FROM raid_groups").first()).toEqual({
    count: 2,
  });
  expect(
    await env.DB.prepare("SELECT state FROM help_requests WHERE id=?")
      .bind(source.members[0]?.requestId)
      .first(),
  ).toEqual({ state: 1 });
  expect((await repo.getBoardSnapshot()).raidCount).toBe(1);
});

it("uses pinned service order rather than original grouping order for the destination", async () => {
  const repo = new D1MvpRepository(env.DB);
  await request(repo, "earlier-full", "the-lab", "pve", 1);
  const sourceRequest = await request(repo, "source");
  const source = (await repo.getBoardSnapshot()).raids[1];
  if (source === undefined) throw new Error("Missing source");
  await repo.reviewRaid({ groupId: source.id, changedAt: at });
  await repo.setRaidStaffMessage(source.id, "review-message", at);
  await env.DB.prepare("UPDATE raid_groups SET requester_capacity=4 WHERE id=1").run();
  expect((await repo.getRaid(source.id))?.nextMoveRaidId).toBeUndefined();
  await env.DB.prepare("UPDATE raid_groups SET manual_order=10 WHERE id=?").bind(source.id).run();
  expect((await repo.getRaid(source.id))?.nextMoveRaidId).toBe(1);
  const moved = await move(repo, source);
  expect(moved.dedicated.id).toBe(1);
  expect(moved.dedicated.members.map((member) => member.requestId)).toContain(
    sourceRequest.request.id,
  );
});

it.each(["full", "reviewed", "active", "earlier", "other-mode", "other-map"] as const)(
  "excludes an ineligible %s destination",
  async (kind) => {
    const { repo, source } = await fixture();
    const existing = await request(
      repo,
      "destination",
      kind === "other-map" ? "woods" : "the-lab",
      kind === "other-mode" ? "pvp" : "pve",
    );
    const destination = await env.DB.prepare(
      "SELECT group_id AS id FROM raid_group_members WHERE request_id=? AND state=0",
    )
      .bind(existing.request.id)
      .first<{ id: number }>();
    if (destination === null) throw new Error("Missing destination");
    if (kind === "full")
      await env.DB.prepare("UPDATE raid_groups SET requester_capacity=1 WHERE id=?")
        .bind(destination.id)
        .run();
    if (kind === "reviewed" || kind === "active") {
      await repo.reviewRaid({ groupId: destination.id, changedAt: at });
      await repo.setRaidStaffMessage(destination.id, "other-review", at);
    }
    if (kind === "active")
      await repo.startRaid({
        groupId: destination.id,
        leaderDiscordUserId: "leader",
        leaderType: "streamer",
        requestTwitchCall: false,
        changedAt: at,
      });
    if (kind === "earlier")
      await env.DB.prepare("UPDATE raid_groups SET manual_order=10 WHERE id=?")
        .bind(destination.id)
        .run();
    expect((await repo.getRaid(source.id))?.nextMoveRaidId).toBeUndefined();
    const before = await repo.getRaid(source.id);
    await expect(move(repo, source)).rejects.toThrow("No later compatible raid has room");
    expect(await repo.getRaid(source.id)).toEqual(before);
  },
);

it.each(["full", "reviewed", "active-source"] as const)(
  "rolls back a move when %s wins the transaction race",
  async (kind) => {
    const { repo, source } = await fixture();
    await request(repo, "destination");
    const destinationId = (await repo.getRaid(source.id))?.nextMoveRaidId;
    if (destinationId === undefined) throw new Error("Missing destination");
    let sourceAfterRace: unknown;
    const racing = new D1MvpRepository(
      beforeBatch(async () => {
        if (kind === "full")
          await env.DB.prepare("UPDATE raid_groups SET requester_capacity=1 WHERE id=?")
            .bind(destinationId)
            .run();
        if (kind === "reviewed") await repo.reviewRaid({ groupId: destinationId, changedAt: at });
        if (kind === "active-source")
          await repo.startRaid({
            groupId: source.id,
            leaderDiscordUserId: "leader",
            leaderType: "streamer",
            requestTwitchCall: false,
            changedAt: at,
          });
        sourceAfterRace = await env.DB.prepare("SELECT * FROM raid_groups WHERE id=?")
          .bind(source.id)
          .first();
      }),
    );
    await expect(move(racing, source)).rejects.toThrow("out of date");
    expect(
      await env.DB.prepare("SELECT * FROM raid_groups WHERE id=?").bind(source.id).first(),
    ).toEqual(sourceAfterRace);
    expect((await repo.getRaid(source.id))?.members.map((member) => member.requestId)).toEqual(
      source.members.map((member) => member.requestId),
    );
    expect((await repo.getRaid(destinationId))?.members).toHaveLength(1);
  },
);

it("rolls back source, membership, and board state when destination storage fails", async () => {
  const { repo, source } = await fixture();
  await request(repo, "destination");
  const before = await repo.getBoardSnapshot();
  const sourceBefore = await repo.getRaid(source.id);
  const destinationId = sourceBefore?.nextMoveRaidId;
  if (destinationId === undefined) throw new Error("Missing destination");
  await env.DB.prepare(`CREATE TRIGGER reject_reviewed_move BEFORE INSERT ON raid_group_members
    WHEN NEW.group_id=${destinationId} BEGIN SELECT RAISE(ABORT,'injected destination failure'); END`).run();
  try {
    await expect(move(repo, source)).rejects.toThrow("injected destination failure");
    expect(await repo.getRaid(source.id)).toEqual(sourceBefore);
    expect((await repo.getBoardSnapshot()).boardVersion).toBe(before.boardVersion);
    expect((await repo.getRaid(destinationId))?.members).toHaveLength(1);
  } finally {
    await env.DB.prepare("DROP TRIGGER reject_reviewed_move").run();
  }
});

it("rejects an old destination token instead of moving into a different available raid", async () => {
  const { repo, source } = await fixture();
  await request(repo, "first-destination");
  const destinationId = (await repo.getRaid(source.id))?.nextMoveRaidId;
  if (destinationId === undefined) throw new Error("Missing destination");
  await repo.reviewRaid({ groupId: destinationId, changedAt: at });
  await request(repo, "second-destination");
  const before = await repo.getRaid(source.id);
  expect(before?.nextMoveRaidId).not.toBe(destinationId);
  await expect(
    repo.postponeRequester({
      groupId: source.id,
      requestId: source.members[0]?.requestId ?? 0,
      actionKey: "stale-destination",
      changedAt: at,
      expectedState: "planned",
      expectedStaffMessageId: "review-message",
      expectedDestinationId: destinationId,
    }),
  ).rejects.toThrow("out of date");
  expect(await repo.getRaid(source.id)).toEqual(before);
});

it("seeks past a large frozen backlog through the indexed eligible destination range", async () => {
  const { repo, source } = await fixture();
  await env.DB.prepare(`WITH RECURSIVE ids(id) AS (SELECT 2 UNION ALL SELECT id+1 FROM ids WHERE id<10002)
    INSERT INTO raid_groups (id,game_mode,map_id,sort_key,requester_capacity,automatic_fill,created_at,updated_at)
    SELECT id,2,'the-lab',id*1000000,4,0,1,1 FROM ids`).run();
  await request(repo, "destination");
  const metrics = new D1Metrics();
  let capturedSql = "";
  const tracing = new Proxy(env.DB, {
    get(db, key) {
      if (key === "prepare")
        return (sql: string) => {
          if (sql.includes("d1:raid.hydrate")) capturedSql = sql;
          return db.prepare(sql);
        };
      const value = Reflect.get(db, key);
      return typeof value === "function" ? value.bind(db) : value;
    },
  });
  const raid = await new D1MvpRepository(instrumentD1Database(tracing, metrics)).getRaid(source.id);
  expect(raid?.nextMoveRaidId).toBe(10003);
  expect(metrics.snapshot().rowsRead).toBeLessThan(30);
  const plan = await env.DB.prepare(`EXPLAIN QUERY PLAN ${capturedSql}`)
    .bind(source.id)
    .all<{ detail: string }>();
  expect(plan.results.map((row) => row.detail).join("\n")).toContain(
    "raid_groups_move_destination_idx (game_mode=? AND map_id=? AND service_key>?)",
  );
});
