import { describe, expect, it } from "vitest";
import mvpTemplate from "../../config/wrangler.mvp.example.jsonc?raw";
import localTemplate from "../../wrangler.jsonc?raw";
import benchmarkTemplate from "../../benchmark/wrangler.local.jsonc?raw";
import benchmarkRunner from "../../scripts/run-d1-benchmark.mjs?raw";
import benchmarkVitest from "../../vitest.benchmark.config.ts?raw";

describe("single-community MVP configuration", () => {
  it("keeps local and live resources distinct", () => {
    expect(localTemplate).toContain("coffee-bot-local");
    expect(mvpTemplate).toContain("coffee-bot-mvp");
    expect(localTemplate).not.toContain("coffee-bot-mvp");
    expect(mvpTemplate).not.toContain("coffee-bot-local");
  });

  it("contains a D1 placeholder rather than a deployable database ID", () => {
    expect(mvpTemplate).toContain("<MVP_D1_DATABASE_ID>");
    expect(mvpTemplate).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
    );
  });

  it("keeps secrets out of committed Wrangler variables", () => {
    for (const contents of [localTemplate, mvpTemplate]) {
      expect(contents).not.toMatch(/"(?:token|secret|password)"\s*:/i);
    }
  });

  it("keeps deployable platform IDs out of committed live configuration", () => {
    expect(mvpTemplate).toContain("<TWITCH_BROADCASTER_USER_ID>");
    expect(mvpTemplate).toContain("<DISCORD_PUBLIC_KEY>");
    expect(mvpTemplate).not.toContain(["5455", "9231"].join(""));
    expect(mvpTemplate).not.toContain(["153785", "2975811141702"].join(""));
  });

  it("keeps the benchmark fail-closed on fully local D1", () => {
    expect(benchmarkTemplate).toContain("coffee-bot-benchmark-local");
    expect(benchmarkTemplate).toContain("00000000-0000-0000-0000-000000000000");
    expect(benchmarkTemplate).not.toContain("coffee-bot-mvp");
    expect(benchmarkTemplate).not.toMatch(/"remote"\s*:\s*true/);
    expect(benchmarkVitest).toContain("./benchmark/wrangler.local.jsonc");
    expect(benchmarkVitest).not.toContain("wrangler.mvp.local");
    expect(benchmarkRunner).toContain("remote command-line options are forbidden");
    expect(benchmarkRunner).toContain("the all-zero local database ID");
  });
});
