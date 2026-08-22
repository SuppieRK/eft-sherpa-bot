import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";

type MigrationEnvironment = typeof env & {
  MIGRATION_DB: D1Database;
  PRE_0008_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
  MIGRATION_0008: Parameters<typeof applyD1Migrations>[1];
};

it("adds a forward-only Twitch identity observation timestamp", async () => {
  const migrationEnvironment = env as MigrationEnvironment;
  const database = migrationEnvironment.MIGRATION_DB;
  await applyD1Migrations(database, migrationEnvironment.PRE_0008_MIGRATIONS);
  await database
    .prepare(
      `INSERT INTO user_mappings
         (twitch_login, twitch_user_id, created_at, updated_at)
       VALUES ('existing_viewer', 'stable-viewer', 10, 10)`,
    )
    .run();

  await applyD1Migrations(database, migrationEnvironment.MIGRATION_0008);

  await expect(
    database
      .prepare(
        `SELECT twitch_observed_at AS twitchObservedAt
         FROM user_mappings WHERE twitch_login = 'existing_viewer'`,
      )
      .first(),
  ).resolves.toEqual({ twitchObservedAt: 0 });
  const column = await database
    .prepare(
      `SELECT "notnull" AS isNotNull, dflt_value AS defaultValue
       FROM pragma_table_info('user_mappings') WHERE name = 'twitch_observed_at'`,
    )
    .first<{ isNotNull: number; defaultValue: string }>();
  expect(column).toEqual({ isNotNull: 1, defaultValue: "0" });
  const objects = await database
    .prepare(
      `SELECT type, name FROM sqlite_schema
       WHERE name IN (
         'raid_group_follow_ups',
         'raid_group_follow_ups_close_cleanup',
         'raid_group_members_removed_request_idx'
       )
       ORDER BY name`,
    )
    .all<{ type: string; name: string }>();
  expect(objects.results).toEqual([
    { type: "table", name: "raid_group_follow_ups" },
    { type: "trigger", name: "raid_group_follow_ups_close_cleanup" },
    { type: "index", name: "raid_group_members_removed_request_idx" },
  ]);

  await database.batch([
    database.prepare(
      `INSERT INTO raid_groups
           (is_priority, game_mode, sort_key, map_id, requester_capacity,
            automatic_fill, state, created_at, updated_at)
         VALUES (0, 2, 1000000, 'customs', 4, 0, 1, 10, 10)`,
    ),
    database.prepare(
      `INSERT INTO raid_groups
           (is_priority, game_mode, sort_key, map_id, requester_capacity,
            automatic_fill, state, created_at, updated_at)
         VALUES (0, 2, 2000000, 'customs', 4, 1, 0, 10, 10)`,
    ),
  ]);
  await database
    .prepare(
      `INSERT INTO raid_group_follow_ups
         (source_group_id, target_group_id, created_at, updated_at)
       VALUES (1, 2, 10, 10)`,
    )
    .run();
  await database
    .prepare(`UPDATE raid_groups SET state = 2, outcome = 1, completed_at = 20 WHERE id = 2`)
    .run();
  await expect(
    database.prepare(`SELECT count(*) AS count FROM raid_group_follow_ups`).first(),
  ).resolves.toEqual({ count: 0 });
});
