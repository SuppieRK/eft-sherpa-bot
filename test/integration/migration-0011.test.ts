import { applyD1Migrations } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect, it } from "vitest";

it("removes old closed follow-up links and indexes future target cleanup", async () => {
  const bindings = env as typeof env & {
    MIGRATION_DB: D1Database;
    TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
  };
  const db = bindings.MIGRATION_DB;
  await applyD1Migrations(db, bindings.TEST_MIGRATIONS.slice(0, 10));
  await db
    .prepare(`INSERT INTO raid_groups
    (id, game_mode, sort_key, map_id, requester_capacity, created_at, updated_at)
    VALUES (1,2,1000000,'customs',4,10,10), (2,2,2000000,'customs',4,10,10),
           (3,2,3000000,'customs',4,10,10)`)
    .run();
  await db.prepare(`INSERT INTO raid_group_follow_ups VALUES (1,2,10,10), (1,3,10,10)`).run();
  await db
    .prepare(`UPDATE raid_groups SET state = 2, outcome = 1, completed_at = 20 WHERE id = 2`)
    .run();
  await applyD1Migrations(db, bindings.TEST_MIGRATIONS.slice(10));
  expect(
    (await db.prepare(`SELECT target_group_id FROM raid_group_follow_ups`).all()).results,
  ).toEqual([{ target_group_id: 3 }]);
  await db
    .prepare(`UPDATE raid_groups SET state = 2, outcome = 1, completed_at = 20 WHERE id = 3`)
    .run();
  expect(
    (await db.prepare(`SELECT target_group_id FROM raid_group_follow_ups`).all()).results,
  ).toEqual([]);
  const plan = await db
    .prepare(`EXPLAIN QUERY PLAN DELETE FROM raid_group_follow_ups WHERE target_group_id = ?`)
    .bind(3)
    .all<{ detail: string }>();
  expect(plan.results.map((row) => row.detail).join("\n")).toContain(
    "raid_group_follow_ups_target_idx",
  );
});
