import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";

type MigrationEnvironment = typeof env & {
  MIGRATION_DB: D1Database;
  PRE_0006_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
  MIGRATION_0006: Parameters<typeof applyD1Migrations>[1];
};

const migrationEnvironment = env as MigrationEnvironment;
const now = Date.parse("2096-08-21T12:00:00.000Z");

it("reconciles stable-ID duplicates and keeps migration 0006 forward compatible", async () => {
  const database = migrationEnvironment.MIGRATION_DB;
  await applyD1Migrations(database, migrationEnvironment.PRE_0006_MIGRATIONS);
  await database.batch([
    database
      .prepare(
        `INSERT OR IGNORE INTO community_state (community_id, created_at, updated_at)
       VALUES ('butcoffee', ?, ?)`,
      )
      .bind(now, now),
    database
      .prepare(
        `INSERT INTO user_mappings
         (twitch_login, twitch_user_id, created_at, updated_at)
       VALUES ('retained_login', 'stable-duplicate', ?, ?),
              ('duplicate_login', NULL, ?, ?)`,
      )
      .bind(now, now, now, now),
    database
      .prepare(
        `INSERT INTO help_requests
         (id, source_platform, source_delivery_id, twitch_user_id, twitch_login,
          in_game_name, game_mode, map_id, objective, state, created_at, updated_at)
       VALUES (1, 1, 'retained-delivery', 'stable-duplicate', 'retained_login',
               'Retained PMC', 2, 'customs', 'Retained goal', 1, ?, ?),
              (2, 1, 'duplicate-delivery', 'stable-duplicate', 'duplicate_login',
               'Duplicate PMC', 2, 'customs', 'Duplicate goal', 1, ?, ?)`,
      )
      .bind(now, now, now + 1, now + 1),
    database
      .prepare(
        `INSERT INTO raid_groups
         (id, is_priority, game_mode, sort_key, map_id, requester_capacity,
          created_at, updated_at)
       VALUES (1, 0, 2, 1000000, 'customs', 4, ?, ?),
              (2, 0, 2, 2000000, 'customs', 4, ?, ?)`,
      )
      .bind(now, now, now + 1, now + 1),
    database
      .prepare(
        `INSERT INTO raid_group_members
         (group_id, request_id, position, created_at, updated_at)
       VALUES (1, 1, 1, ?, ?), (2, 2, 1, ?, ?)`,
      )
      .bind(now, now, now + 1, now + 1),
  ]);

  await applyD1Migrations(database, migrationEnvironment.MIGRATION_0006);

  await expect(
    database.prepare(`SELECT id, state FROM help_requests ORDER BY id`).all(),
  ).resolves.toMatchObject({
    results: [
      { id: 1, state: 1 },
      { id: 2, state: 3 },
    ],
  });
  await expect(
    database
      .prepare(
        `SELECT group_id AS groupId, request_id AS requestId, state
         FROM raid_group_members ORDER BY request_id`,
      )
      .all(),
  ).resolves.toMatchObject({
    results: [
      { groupId: 1, requestId: 1, state: 0 },
      { groupId: 2, requestId: 2, state: 2 },
    ],
  });
  await expect(
    database
      .prepare(
        `SELECT id, state, current_member_count AS memberCount
         FROM raid_groups ORDER BY id`,
      )
      .all(),
  ).resolves.toMatchObject({
    results: [
      { id: 1, state: 0, memberCount: 1 },
      { id: 2, state: 3, memberCount: 0 },
    ],
  });
  await expect(
    database
      .prepare(
        `SELECT stable_identity_repair_count AS repairCount,
                board_dirty_version AS dirtyVersion,
                board_rendered_version AS renderedVersion
         FROM community_state WHERE community_id = 'butcoffee'`,
      )
      .first(),
  ).resolves.toEqual({ repairCount: 1, dirtyVersion: 0, renderedVersion: 0 });
  await expect(
    database
      .prepare(
        `SELECT submitted_requests AS submittedRequests, open_requests AS openRequests,
                canceled_requests AS canceledRequests
         FROM staff_statistics_summary WHERE singleton = 1`,
      )
      .first(),
  ).resolves.toEqual({ submittedRequests: 2, openRequests: 1, canceledRequests: 1 });
  await expect(
    database
      .prepare(
        `SELECT name FROM sqlite_schema
         WHERE type = 'index' AND name = 'help_requests_one_active_mode_map_per_twitch_id'`,
      )
      .first(),
  ).resolves.toEqual({ name: "help_requests_one_active_mode_map_per_twitch_id" });

  await applyD1Migrations(database, migrationEnvironment.MIGRATION_0006);
  await expect(
    database
      .prepare(
        `SELECT stable_identity_repair_count AS repairCount
         FROM community_state WHERE community_id = 'butcoffee'`,
      )
      .first(),
  ).resolves.toEqual({ repairCount: 1 });
});
