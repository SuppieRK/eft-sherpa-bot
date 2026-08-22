import { env } from "cloudflare:workers";
import { applyD1Migrations } from "cloudflare:test";
import { beforeEach } from "vitest";

type TestEnvironment = typeof env & {
  TEST_MIGRATIONS: Parameters<typeof applyD1Migrations>[1];
};

beforeEach(async () => {
  const testEnvironment = env as TestEnvironment;
  await applyD1Migrations(testEnvironment.DB, testEnvironment.TEST_MIGRATIONS);
  await testEnvironment.DB.batch([
    testEnvironment.DB.prepare("DELETE FROM raid_group_follow_ups"),
    testEnvironment.DB.prepare("DELETE FROM raid_group_members"),
    testEnvironment.DB.prepare("DELETE FROM raid_groups"),
    testEnvironment.DB.prepare("DELETE FROM help_requests"),
    testEnvironment.DB.prepare("DELETE FROM user_mappings"),
    testEnvironment.DB.prepare("DELETE FROM community_state"),
    testEnvironment.DB.prepare("DELETE FROM event_receipts"),
    testEnvironment.DB.prepare(
      "DELETE FROM sqlite_sequence WHERE name IN ('help_requests', 'raid_groups', 'raid_group_members')",
    ),
  ]);
});
