import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("merges overlapping old queue keys and preserves identities, parties, history, and calls", async () => {
  const bindings = env as typeof env & {
    MIGRATION_DB: D1Database;
    TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
  };
  const db = bindings.MIGRATION_DB;
  await applyD1Migrations(db, bindings.TEST_MIGRATIONS.slice(0, 11));
  await db
    .prepare(`INSERT INTO user_mappings (twitch_login, created_at, updated_at)
    VALUES ('first',10,10),('second',10,10),('active',10,10),('followup',10,10),('history',10,10),('seasonal',10,10),('waiting',10,10)`)
    .run();
  await db
    .prepare(`INSERT INTO help_requests
    (id,source_platform,source_delivery_id,twitch_login,twitch_user_id,in_game_name,game_mode,map_id,objective,is_priority,state,created_at,updated_at)
    VALUES (1,1,'one','first','10001','First',2,'customs','Goal one',0,1,10,10),
           (2,1,'two','second','10002','Second',2,'customs','Goal two',1,1,10,10),
           (3,1,'three','active','10003','Active',1,'woods','Goal three',1,1,10,10),
           (4,1,'four','followup','10004','Followup',2,'customs','Goal four',1,1,10,10),
           (5,1,'five','history','10005','History',2,'customs','Goal five',1,2,10,10),
           (6,1,'six','seasonal','10006','Seasonal',0,'woods','Goal six',0,1,10,10),
           (7,1,'seven','waiting','10007','Waiting',2,'factory','Goal seven',1,0,10,10)`)
    .run();
  await db
    .prepare(`INSERT INTO raid_groups
    (id,is_priority,game_mode,sort_key,map_id,requester_capacity,automatic_fill,state,
     leader_discord_user_id,leader_type,attempt_count,started_at,discord_call_status,twitch_call_status,
     staff_message_id,outcome,completed_at,created_at,updated_at)
    VALUES (10,0,2,1000000,'customs',4,1,0,NULL,NULL,0,NULL,3,3,NULL,NULL,NULL,10,10),
           (20,1,2,1000000,'customs',4,0,0,'90001',0,0,NULL,3,3,'80001',NULL,NULL,10,10),
           (30,1,1,2000000,'woods',4,0,1,'90002',1,2,30,1,1,'80002',NULL,NULL,10,30),
           (25,1,2,3000000,'customs',4,1,0,'90001',0,0,NULL,3,3,NULL,NULL,NULL,10,10),
           (40,1,2,1000000,'customs',4,0,2,'90001',0,3,20,1,1,NULL,0,40,10,40),
           (50,0,0,2000000,'woods',4,1,0,NULL,NULL,0,NULL,3,3,NULL,NULL,NULL,10,10)`)
    .run();
  await db
    .prepare(`INSERT INTO raid_group_members (group_id,request_id,position,state,created_at,updated_at)
    VALUES (10,1,1,0,10,10),(20,2,1,0,10,10),(30,3,1,0,10,10),(25,4,1,0,10,10),(40,5,1,1,10,40),(50,6,1,0,10,10)`)
    .run();
  await db.prepare(`INSERT INTO raid_group_follow_ups VALUES (20,25,10,10)`).run();
  await db.prepare(`UPDATE community_state SET staff_board_message_id = '70001'`).run();
  await db
    .prepare(
      "UPDATE help_requests SET notes='Preserve the notes',discord_user_id='90003' WHERE id=2",
    )
    .run();
  const mappings = await db.prepare("SELECT * FROM user_mappings ORDER BY twitch_login").all();
  const leaderStatistics = await db
    .prepare("SELECT * FROM staff_leader_statistics ORDER BY discord_user_id")
    .all();
  const projection = `id,game_mode,map_id,requester_capacity,current_member_count,automatic_fill,state,
    leader_discord_user_id,leader_type,attempt_count,started_at,discord_call_status,twitch_call_status,
    staff_message_id,outcome,completed_at,created_at,updated_at`;
  const before = await db.prepare(`SELECT ${projection} FROM raid_groups ORDER BY id`).all();
  const members = await db.prepare(`SELECT * FROM raid_group_members ORDER BY id`).all();
  const requests = await db.prepare(`SELECT * FROM help_requests ORDER BY id`).all();
  for (const request of requests.results) {
    if (request.state === 0 || request.state === 1) request.is_priority = 0;
  }
  const statistics = await db.prepare(`SELECT * FROM staff_statistics_summary`).all();
  await applyD1Migrations(db, bindings.TEST_MIGRATIONS.slice(11, 12));
  expect(
    (await db.prepare(`SELECT ${projection} FROM raid_groups ORDER BY id`).all()).results,
  ).toEqual(before.results);
  expect((await db.prepare(`SELECT * FROM raid_group_members ORDER BY id`).all()).results).toEqual(
    members.results,
  );
  expect((await db.prepare(`SELECT * FROM help_requests ORDER BY id`).all()).results).toEqual(
    requests.results,
  );
  expect(
    (await db.prepare("SELECT * FROM user_mappings ORDER BY twitch_login").all()).results,
  ).toEqual(mappings.results);
  expect(
    (await db.prepare("SELECT * FROM staff_leader_statistics ORDER BY discord_user_id").all())
      .results,
  ).toEqual(leaderStatistics.results);
  expect((await db.prepare(`SELECT * FROM staff_statistics_summary`).all()).results).toEqual(
    statistics.results,
  );
  expect(
    (
      await db
        .prepare(
          `SELECT id,sort_key,is_priority FROM raid_groups WHERE state IN (0,1) ORDER BY sort_key`,
        )
        .all()
    ).results,
  ).toEqual([
    { id: 20, sort_key: 1000000, is_priority: 0 },
    { id: 30, sort_key: 2000000, is_priority: 0 },
    { id: 25, sort_key: 3000000, is_priority: 0 },
    { id: 10, sort_key: 4000000, is_priority: 0 },
    { id: 50, sort_key: 5000000, is_priority: 0 },
  ]);
  expect(
    (await db.prepare(`SELECT source_group_id,target_group_id FROM raid_group_follow_ups`).all())
      .results,
  ).toEqual([{ source_group_id: 20, target_group_id: 25 }]);
  expect(
    await db
      .prepare(
        `SELECT staff_board_message_id,raid_count,board_page_number,board_page_direction,board_dirty_version FROM community_state`,
      )
      .first(),
  ).toEqual({
    staff_board_message_id: "70001",
    raid_count: 5,
    board_page_number: 1,
    board_page_direction: 0,
    board_dirty_version: 1,
  });
  expect(
    await db
      .prepare(`SELECT sort_key,attempt_count,is_priority FROM raid_groups WHERE id=40`)
      .first(),
  ).toEqual({ sort_key: 1000000, attempt_count: 3, is_priority: 1 });
  await db.prepare(`UPDATE raid_groups SET manual_order=5 WHERE id=10`).run();
  expect(
    (
      await db
        .prepare(
          `SELECT id FROM raid_groups WHERE state IN (0,1) ORDER BY service_lane,service_key,id`,
        )
        .all()
    ).results,
  ).toEqual([{ id: 30 }, { id: 10 }, { id: 20 }, { id: 25 }, { id: 50 }]);
  const plan = await db
    .prepare(`EXPLAIN QUERY PLAN SELECT id FROM raid_groups
    WHERE state IN (0,1) AND (service_lane,service_key,id) > (1,-5,10)
    ORDER BY service_lane,service_key,id LIMIT 11`)
    .all<{ detail: string }>();
  expect(plan.results.map((row) => row.detail).join("\n")).toContain(
    "raid_groups_service_order_idx",
  );
  expect(plan.results.map((row) => row.detail).join("\n")).not.toContain("TEMP B-TREE");
  await expect(
    db.prepare(`UPDATE raid_groups SET sort_key=1000000 WHERE id=10`).run(),
  ).rejects.toThrow();
});
