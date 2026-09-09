import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";

type MigrationEnvironment = typeof env & {
  MIGRATION_DB: D1Database;
  PRE_0010_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
  MIGRATION_0010: Parameters<typeof applyD1Migrations>[1];
};

it("indexes reserved pull sources without changing raids or breaking the previous query", async () => {
  const migrationEnvironment = env as MigrationEnvironment;
  const database = migrationEnvironment.MIGRATION_DB;
  await applyD1Migrations(database, migrationEnvironment.PRE_0010_MIGRATIONS);
  await database
    .prepare(`INSERT INTO raid_groups
    (sort_key, game_mode, map_id, requester_capacity, automatic_fill,
     leader_discord_user_id, leader_type, created_at, updated_at)
    VALUES (1000000, 1, 'shoreline', 4, 0, 'reserved-leader', 1, 10, 10),
           (2000000, 1, 'shoreline', 4, 1, NULL, NULL, 10, 10)`)
    .run();
  const before = await database.prepare("SELECT * FROM raid_groups ORDER BY id").all();
  await applyD1Migrations(database, migrationEnvironment.MIGRATION_0010);
  expect((await database.prepare("SELECT * FROM raid_groups ORDER BY id").all()).results).toEqual(
    before.results,
  );

  const query = `SELECT id FROM raid_groups INDEXED BY raid_groups_pull_source_idx
    WHERE is_priority = 0 AND game_mode = 1 AND map_id = 'shoreline'
      AND state = 0 AND staff_message_id IS NULL
      AND (automatic_fill = 1 OR leader_discord_user_id IS NOT NULL)
      AND sort_key > 0
    ORDER BY sort_key LIMIT 1`;
  expect(await database.prepare(query).first()).toEqual({ id: 1 });
  const plan = await database.prepare(`EXPLAIN QUERY PLAN ${query}`).all<{ detail: string }>();
  expect(plan.results.map((row) => row.detail).join("\n")).toContain(
    "USING INDEX raid_groups_pull_source_idx (is_priority=? AND game_mode=? AND map_id=? AND sort_key>?)",
  );
  await expect(
    database
      .prepare(`SELECT id FROM raid_groups INDEXED BY raid_groups_pull_source_idx
    WHERE is_priority = 0 AND game_mode = 1 AND map_id = 'shoreline'
      AND state = 0 AND automatic_fill = 1
      AND leader_discord_user_id IS NULL AND staff_message_id IS NULL
    ORDER BY sort_key LIMIT 1`)
      .first(),
  ).resolves.toEqual({ id: 2 });
});
