import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));
      return {
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          d1Databases: { MIGRATION_DB: "coffee-bot-migration-test" },
          bindings: {
            TEST_MIGRATIONS: migrations,
            PRE_0006_MIGRATIONS: migrations.slice(0, 5),
            MIGRATION_0006: migrations.slice(5, 6),
            PRE_0007_MIGRATIONS: migrations.slice(0, 6),
            MIGRATION_0007: migrations.slice(6, 7),
            PRE_0008_MIGRATIONS: migrations.slice(0, 7),
            MIGRATION_0008: migrations.slice(7, 8),
            PRE_0009_MIGRATIONS: migrations.slice(0, 8),
            MIGRATION_0009: migrations.slice(8, 9),
            PRE_0010_MIGRATIONS: migrations.slice(0, 9),
            MIGRATION_0010: migrations.slice(9, 10),
            TWITCH_APP_ACCESS_TOKEN: "test-app-access-token",
            TWITCH_EVENTSUB_SECRET: "test-eventsub-secret-is-long-enough",
            SPIKE_DIAGNOSTICS_TOKEN: "test-diagnostics-token",
            DISCORD_BOT_TOKEN: "test-discord-bot-token",
            DISCORD_API_BASE_URL: "https://discord.test/api/v10",
          },
        },
      };
    }),
  ],
  test: {
    coverage: {
      enabled: process.env.VITEST_COVERAGE === "true",
      provider: "istanbul",
      reporter: ["text-summary", "lcov"],
      include: ["src/**/*.ts"],
      exclude: ["src/worker-configuration.d.ts"],
    },
    fileParallelism: false,
    include: ["test/**/*.test.ts"],
    setupFiles: ["./test/setup.ts"],
  },
});
