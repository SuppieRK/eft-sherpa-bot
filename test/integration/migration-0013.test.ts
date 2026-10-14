import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("adds the destination index without changing domain records or call state", async () => {
  const bindings = env as typeof env & {
    MIGRATION_DB: D1Database;
    TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
  };
  const db = bindings.MIGRATION_DB;
  await applyD1Migrations(db, bindings.TEST_MIGRATIONS.slice(0, 12));
  await db.batch([
    db.prepare(
      "INSERT INTO user_mappings (twitch_login,twitch_user_id,created_at,updated_at) VALUES ('seed_one','seed-user-one',1,1),('seed_two','seed-user-two',1,1)",
    ),
    db.prepare(`INSERT INTO help_requests (id,source_platform,source_delivery_id,twitch_login,twitch_user_id,in_game_name,game_mode,map_id,objective,notes,state,created_at,updated_at)
      VALUES (1,1,'seed-one','seed_one','seed-user-one','Test PMC',2,'the-lab','Test goal','Test notes',1,1,1),
             (2,1,'seed-two','seed_two','seed-user-two','Other PMC',2,'the-lab','Other goal',NULL,1,1,1)`),
    db.prepare(`INSERT INTO raid_groups (id,game_mode,map_id,sort_key,requester_capacity,automatic_fill,leader_discord_user_id,leader_type,staff_message_id,manual_order,created_at,updated_at)
      VALUES (1,2,'the-lab',1000000,4,0,'reserved-leader',0,'review-message',10,1,1),
             (2,2,'the-lab',2000000,4,1,NULL,NULL,NULL,0,1,1)`),
    db.prepare(
      "INSERT INTO raid_group_members (group_id,request_id,position,created_at,updated_at) VALUES (1,1,1,1,1),(2,2,1,1,1)",
    ),
    db.prepare(
      "INSERT INTO event_receipts (platform,delivery_id,event_type,received_at,discord_mutation_status) VALUES (0,'retained-receipt','test',1,1)",
    ),
    db.prepare(
      "UPDATE community_state SET staff_board_message_id='canonical',board_page_number=2,board_page_direction=1,board_page_key=2000000,board_page_id=2,board_dirty_version=7",
    ),
  ]);
  const tables = [
    "help_requests",
    "raid_groups",
    "raid_group_members",
    "user_mappings",
    "event_receipts",
    "staff_statistics_summary",
    "staff_leader_statistics",
    "raid_group_follow_ups",
  ];
  const before = await db.batch(tables.map((table) => db.prepare(`SELECT * FROM ${table}`)));
  await applyD1Migrations(db, bindings.TEST_MIGRATIONS.slice(12, 13));
  const after = await db.batch(tables.map((table) => db.prepare(`SELECT * FROM ${table}`)));
  expect(after.map((result) => result.results)).toEqual(before.map((result) => result.results));
  expect(
    await db
      .prepare(
        "SELECT board_dirty_version AS dirty,board_page_number AS page,board_page_direction AS direction,board_page_key AS key,board_page_id AS id,raid_count AS count FROM community_state",
      )
      .first(),
  ).toEqual({ dirty: 8, page: 1, direction: 0, key: 0, id: 0, count: 2 });
  const plan = await db
    .prepare(`EXPLAIN QUERY PLAN SELECT id FROM raid_groups INDEXED BY raid_groups_move_destination_idx
    WHERE state=0 AND automatic_fill=1 AND staff_message_id IS NULL AND current_member_count<requester_capacity
      AND game_mode=2 AND map_id='the-lab' AND (service_key,id)>(-10,1)
    ORDER BY service_key,id LIMIT 1`)
    .all<{ detail: string }>();
  expect(plan.results.map((row) => row.detail).join("\n")).toContain(
    "raid_groups_move_destination_idx",
  );
});
