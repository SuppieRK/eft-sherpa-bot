import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";

type MigrationEnvironment = typeof env & {
  MIGRATION_DB: D1Database;
  PRE_0009_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
  MIGRATION_0009: Parameters<typeof applyD1Migrations>[1];
};

it("cleans follow-ups through their source key after migration 0009", async () => {
  const migrationEnvironment = env as MigrationEnvironment;
  const database = migrationEnvironment.MIGRATION_DB;
  await applyD1Migrations(database, migrationEnvironment.PRE_0009_MIGRATIONS);
  await applyD1Migrations(database, migrationEnvironment.MIGRATION_0009);
  await database
    .prepare(
      `INSERT INTO raid_groups
       (is_priority, game_mode, sort_key, map_id, requester_capacity,
        automatic_fill, state, created_at, updated_at)
     VALUES (0, 2, 1000000, 'customs', 4, 0, 1, 10, 10),
            (0, 2, 2000000, 'customs', 4, 1, 0, 10, 10),
            (0, 2, 3000000, 'customs', 4, 0, 1, 10, 10)`,
    )
    .run();
  await database
    .prepare(
      `INSERT INTO raid_group_follow_ups
       (source_group_id, target_group_id, created_at, updated_at)
     VALUES (1, 2, 10, 10), (3, 2, 10, 10)`,
    )
    .run();

  await database
    .prepare(`UPDATE raid_groups SET state = 2, outcome = 1, completed_at = 20 WHERE id = 2`)
    .run();
  await expect(
    database
      .prepare(`SELECT source_group_id AS sourceId FROM raid_group_follow_ups ORDER BY 1`)
      .all(),
  ).resolves.toMatchObject({ results: [{ sourceId: 1 }, { sourceId: 3 }] });

  await database
    .prepare(`UPDATE raid_groups SET state = 2, outcome = 1, completed_at = 30 WHERE id = 1`)
    .run();
  await expect(
    database
      .prepare(`SELECT source_group_id AS sourceId FROM raid_group_follow_ups ORDER BY 1`)
      .all(),
  ).resolves.toMatchObject({ results: [{ sourceId: 3 }] });

  const plan = await database
    .prepare(`EXPLAIN QUERY PLAN DELETE FROM raid_group_follow_ups WHERE source_group_id = ?`)
    .bind(3)
    .all<{ detail: string }>();
  expect(plan.results.map((row) => row.detail).join("\n")).toContain(
    "SEARCH raid_group_follow_ups USING PRIMARY KEY (source_group_id=?)",
  );
});
