import path from "node:path";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => ({
      wrangler: { configPath: "./benchmark/wrangler.local.jsonc" },
      miniflare: {
        bindings: {
          TEST_MIGRATIONS: await readD1Migrations(path.join(import.meta.dirname, "migrations")),
          TWITCH_APP_ACCESS_TOKEN: "benchmark-app-access-token",
          TWITCH_EVENTSUB_SECRET: "benchmark-eventsub-secret-is-long-enough",
          SPIKE_DIAGNOSTICS_TOKEN: "benchmark-diagnostics-token",
          DISCORD_BOT_TOKEN: "benchmark-discord-bot-token",
          BENCHMARK_SCALE: Number(process.env.BENCHMARK_SCALE ?? 0),
        },
      },
    })),
  ],
  test: {
    fileParallelism: false,
    include: ["benchmark/**/*.benchmark.ts"],
    setupFiles: ["./test/setup.ts"],
    hookTimeout: 1_200_000,
    testTimeout: 1_200_000,
  },
});
