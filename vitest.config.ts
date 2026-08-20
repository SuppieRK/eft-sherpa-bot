import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          TWITCH_APP_ACCESS_TOKEN: "test-app-access-token",
          TWITCH_EVENTSUB_SECRET: "test-eventsub-secret-is-long-enough",
          SPIKE_DIAGNOSTICS_TOKEN: "test-diagnostics-token",
          DISCORD_BOT_TOKEN: "test-discord-bot-token",
          DISCORD_API_BASE_URL: "https://discord.test/api/v10",
        },
      },
    })),
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
