export interface OperationMeasurement {
  wallMs: number;
  d1DurationMs: number;
  statements: number;
  rowsRead: number;
  rowsWritten: number;
  statementGroups?: Record<string, D1CounterGroup>;
}

interface D1CounterGroup {
  statements: number;
  rowsRead: number;
  rowsWritten: number;
}

interface Distribution {
  min: number;
  median: number;
  p95: number;
  max: number;
}

export interface AggregatedMeasurement {
  wallMs: Distribution;
  d1DurationMs: Distribution;
  statements: Distribution;
  rowsRead: Distribution;
  rowsWritten: Distribution;
}

function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) throw new Error("Cannot aggregate an empty measurement set.");
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.ceil(fraction * sorted.length) - 1);
  return sorted[index] as number;
}

function distribution(values: readonly number[]): Distribution {
  return {
    min: percentile(values, 0),
    median: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: percentile(values, 1),
  };
}

export function aggregateMeasurements(
  measurements: readonly OperationMeasurement[],
): AggregatedMeasurement {
  return {
    wallMs: distribution(measurements.map((measurement) => measurement.wallMs)),
    d1DurationMs: distribution(measurements.map((measurement) => measurement.d1DurationMs)),
    statements: distribution(measurements.map((measurement) => measurement.statements)),
    rowsRead: distribution(measurements.map((measurement) => measurement.rowsRead)),
    rowsWritten: distribution(measurements.map((measurement) => measurement.rowsWritten)),
  };
}

export function assertStableCost(measurements: readonly OperationMeasurement[]): void {
  if (measurements.length === 0) throw new Error("No measured samples were produced.");
  for (const key of ["statements", "rowsRead", "rowsWritten"] as const) {
    const values = new Set(measurements.map((measurement) => measurement[key]));
    if (values.size !== 1) {
      throw new Error(
        `${key} changed between identical measured samples: ${[...values].join(", ")}`,
      );
    }
  }
  const statementGroups = new Set(
    measurements.map((measurement) => JSON.stringify(measurement.statementGroups ?? {})),
  );
  if (statementGroups.size !== 1) {
    throw new Error("statementGroups changed between identical measured samples");
  }
  const statementCount = measurements[0]?.statements ?? Number.POSITIVE_INFINITY;
  if (statementCount > 50) {
    throw new Error(`The operation used ${statementCount} D1 statements; the limit is 50.`);
  }
}
