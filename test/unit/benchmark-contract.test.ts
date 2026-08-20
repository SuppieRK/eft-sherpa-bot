import { describe, expect, it } from "vitest";
import {
  BENCHMARK_OPERATION_FAMILIES,
  BENCHMARK_SAMPLES,
  BENCHMARK_SCALES,
  BENCHMARK_WARMUPS,
  OPERATION_FAMILY_BY_ID,
  QUEUE_PERCENTILES,
  USER_OPERATION_IDS,
} from "../../benchmark/contract";
import {
  aggregateMeasurements,
  assertStableCost,
  type OperationMeasurement,
} from "../../benchmark/statistics";
import surface from "../../config/command-surface.json";

const measurement = (wallMs: number): OperationMeasurement => ({
  wallMs,
  d1DurationMs: wallMs / 2,
  statements: 5,
  rowsRead: 20,
  rowsWritten: 3,
});

describe("local user-facing benchmark contract", () => {
  it("uses the approved scales, sampling, and queue positions", () => {
    expect(BENCHMARK_SCALES).toEqual([100, 1_000, 10_000, 100_000]);
    expect(BENCHMARK_WARMUPS).toBe(3);
    expect(BENCHMARK_SAMPLES).toBe(10);
    expect(QUEUE_PERCENTILES).toEqual([10, 50, 90]);
  });

  it("covers every registered command and selected control family", () => {
    expect(new Set(USER_OPERATION_IDS).size).toBe(USER_OPERATION_IDS.length);
    expect(new Set(Object.values(OPERATION_FAMILY_BY_ID))).toEqual(
      new Set(BENCHMARK_OPERATION_FAMILIES),
    );
    expect(surface.public.map((command) => command.name)).toEqual(["request", "queue"]);
    expect(surface.discordViewer.map((command) => command.name)).toEqual(["link-twitch"]);
    expect(surface.discordStaff.map((command) => command.name)).toEqual(["board"]);
    const families = new Set(Object.values(OPERATION_FAMILY_BY_ID));
    for (const family of [
      "discord:request",
      "discord:queue",
      "discord:link-twitch",
      "twitch:request",
      "twitch:queue",
      "board:create",
      "board:open",
      "board:refresh",
      "raid:review",
      "raid:cancel-review",
      "raid:call-start",
      "raid:result",
      "raid:postpone-requester",
      "raid:remove-requester",
      "raid:pull-requester",
    ]) {
      expect(families.has(family as (typeof BENCHMARK_OPERATION_FAMILIES)[number])).toBe(true);
    }
  });

  it("uses nearest-rank statistics and rejects unstable D1 counters", () => {
    const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(measurement);
    expect(aggregateMeasurements(values).wallMs).toEqual({
      min: 1,
      median: 5,
      p95: 10,
      max: 10,
    });
    expect(() => assertStableCost(values)).not.toThrow();
    expect(() =>
      assertStableCost([...values.slice(0, 9), { ...measurement(10), rowsRead: 21 }]),
    ).toThrow(/rowsRead changed/);
    expect(() => assertStableCost(values.map((value) => ({ ...value, statements: 51 })))).toThrow(
      /limit is 50/,
    );
  });
});
