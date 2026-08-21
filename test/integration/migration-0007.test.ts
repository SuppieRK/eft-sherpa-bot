import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { expect, it } from "vitest";

type MigrationEnvironment = typeof env & {
  MIGRATION_DB: D1Database;
  PRE_0007_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
  MIGRATION_0007: Parameters<typeof applyD1Migrations>[1];
};

it("adds fenced delivery claims without changing migration 0006", async () => {
  const migrationEnvironment = env as MigrationEnvironment;
  const database = migrationEnvironment.MIGRATION_DB;
  await applyD1Migrations(database, migrationEnvironment.PRE_0007_MIGRATIONS);
  await applyD1Migrations(database, migrationEnvironment.MIGRATION_0007);

  const columns = await database
    .prepare(`SELECT name FROM pragma_table_info('event_receipts') ORDER BY cid`)
    .all<{ name: string }>();
  expect(columns.results.map(({ name }) => name)).toEqual(
    expect.arrayContaining([
      "discord_claim_token",
      "twitch_processing_until",
      "twitch_processing_token",
      "twitch_send_token",
    ]),
  );

  await database
    .prepare(
      `INSERT INTO user_mappings
         (twitch_login, twitch_user_id, discord_user_id, in_game_name, created_at, updated_at)
       VALUES ('verified_viewer', 'stable-one', 'discord-one', 'PMC One', 1, 1)`,
    )
    .run();
  await expect(
    database
      .prepare(
        `UPDATE user_mappings SET twitch_user_id = 'stable-two'
         WHERE twitch_login = 'verified_viewer'`,
      )
      .run(),
  ).rejects.toThrow("stable Twitch identity conflict");
  await expect(
    database
      .prepare(
        `SELECT twitch_user_id AS twitchUserId, discord_user_id AS discordUserId,
                in_game_name AS inGameName
         FROM user_mappings WHERE twitch_login = 'verified_viewer'`,
      )
      .first(),
  ).resolves.toEqual({
    twitchUserId: "stable-one",
    discordUserId: "discord-one",
    inGameName: "PMC One",
  });
});
