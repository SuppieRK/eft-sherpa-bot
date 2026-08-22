import { describe, expect, it } from "vitest";
import {
  assertExactD1Baseline,
  baselineKey,
  createD1CostBaseline,
  type D1CostBaseline,
} from "../../benchmark/baseline";
import {
  BENCHMARK_OPERATION_FAMILIES,
  BENCHMARK_SAMPLES,
  BENCHMARK_SCALES,
  BENCHMARK_SCALES_BY_OPERATION,
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
import committedBaseline from "../../benchmark/d1-cost-baseline.json";

const measurement = (wallMs: number): OperationMeasurement => ({
  wallMs,
  d1DurationMs: wallMs / 2,
  bindingCalls: 4,
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
    expect(surface.discordStaff.map((command) => command.name)).toEqual([
      "board",
      "stats",
      "users",
    ]);
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
      "discord:stats",
      "discord:users-page",
      "discord:users-complete",
      "operator:status",
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
    expect(() =>
      assertStableCost(values.map((value) => Object.assign({}, value, { statements: 51 }))),
    ).not.toThrow();
  });

  it("commits one exact counter baseline entry for every scale and operation", () => {
    const baseline = committedBaseline as unknown as D1CostBaseline;
    const expected = USER_OPERATION_IDS.flatMap((operationId) =>
      (BENCHMARK_SCALES_BY_OPERATION[operationId] ?? BENCHMARK_SCALES).map((scale) =>
        baselineKey(scale, operationId),
      ),
    ).sort();

    expect(Object.keys(baseline.operations).sort()).toEqual(expected);
    expect(Object.keys(baseline.databaseBytes).sort()).toEqual(BENCHMARK_SCALES.map(String).sort());
  });

  it("reports exact D1 counter changes and missing entries", () => {
    const report = {
      seeds: [{ scale: BENCHMARK_SCALES[0], databaseBytes: 123 }],
      results: [
        {
          id: USER_OPERATION_IDS[0],
          scale: BENCHMARK_SCALES[0],
          aggregate: aggregateMeasurements([measurement(10)]),
        },
      ],
    };
    const baseline = createD1CostBaseline(report);
    expect(() => assertExactD1Baseline(report, baseline)).not.toThrow();
    const changed: D1CostBaseline = {
      schemaVersion: 4,
      databaseBytes: baseline.databaseBytes,
      focusedOperations: baseline.focusedOperations,
      operations: {
        ...baseline.operations,
        [baselineKey(BENCHMARK_SCALES[0], USER_OPERATION_IDS[0])]: {
          statements: 6,
          bindingCalls: 4,
          rowsRead: 20,
          rowsWritten: 3,
        },
        "100:extra.operation": {
          bindingCalls: 1,
          statements: 1,
          rowsRead: 1,
          rowsWritten: 0,
        },
      },
    };
    expect(() => assertExactD1Baseline(report, changed)).toThrow(
      /missing from benchmark report[\s\S]*statements: expected 6, measured 5/,
    );
  });

  it("updates only deterministic counters and ignores timing", () => {
    const base = {
      id: USER_OPERATION_IDS[0],
      scale: BENCHMARK_SCALES[0],
    };
    const first = createD1CostBaseline({
      seeds: [{ scale: BENCHMARK_SCALES[0], databaseBytes: 123 }],
      results: [{ ...base, aggregate: aggregateMeasurements([measurement(10)]) }],
    });
    const second = createD1CostBaseline({
      seeds: [{ scale: BENCHMARK_SCALES[0], databaseBytes: 123 }],
      results: [{ ...base, aggregate: aggregateMeasurements([measurement(999)]) }],
    });

    expect(second).toEqual(first);
  });
});
