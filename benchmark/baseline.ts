import type { UserOperationId } from "./contract";

interface DeterministicD1Counters {
  statements: number;
  rowsRead: number;
  rowsWritten: number;
}

interface BenchmarkResultLike {
  id: UserOperationId;
  scale: number;
  aggregate: {
    statements: { median: number };
    rowsRead: { median: number };
    rowsWritten: { median: number };
  };
  statementGroups?: Record<string, DeterministicD1Counters>;
}

export interface D1CostBaseline {
  schemaVersion: 3;
  databaseBytes: Record<string, number>;
  operations: Record<string, DeterministicD1Counters>;
  focusedOperations: Record<string, Record<string, DeterministicD1Counters>>;
}

export function baselineKey(scale: number, operationId: UserOperationId): string {
  return `${scale}:${operationId}`;
}

export function createD1CostBaseline(report: {
  results: readonly BenchmarkResultLike[];
  seeds?: readonly { scale: number; databaseBytes: number }[];
}): D1CostBaseline {
  const operations: Record<string, DeterministicD1Counters> = {};
  for (const result of report.results) {
    operations[baselineKey(result.scale, result.id)] = {
      statements: result.aggregate.statements.median,
      rowsRead: result.aggregate.rowsRead.median,
      rowsWritten: result.aggregate.rowsWritten.median,
    };
  }
  const databaseBytes = Object.fromEntries(
    (report.seeds ?? []).map((seed) => [String(seed.scale), seed.databaseBytes]),
  );
  const focusedOperations = Object.fromEntries(
    report.results.flatMap((result) =>
      result.statementGroups === undefined
        ? []
        : [[baselineKey(result.scale, result.id), result.statementGroups]],
    ),
  );
  return { schemaVersion: 3, databaseBytes, operations, focusedOperations };
}

export function assertExactD1Baseline(
  report: {
    results: readonly BenchmarkResultLike[];
    seeds?: readonly { scale: number; databaseBytes: number }[];
  },
  baseline: D1CostBaseline,
): void {
  const actual = createD1CostBaseline(report);
  const expectedKeys = Object.keys(baseline.operations).sort();
  const actualKeys = Object.keys(actual.operations).sort();
  const differences: string[] = [];
  const expectedDatabaseScales = Object.keys(baseline.databaseBytes).sort();
  const actualDatabaseScales = Object.keys(actual.databaseBytes).sort();
  if (JSON.stringify(expectedDatabaseScales) !== JSON.stringify(actualDatabaseScales)) {
    differences.push("database size scales differ from the committed baseline");
  }
  for (const scale of actualDatabaseScales.filter((scale) => scale in baseline.databaseBytes)) {
    if (actual.databaseBytes[scale] !== baseline.databaseBytes[scale]) {
      differences.push(
        `${scale} databaseBytes: expected ${String(baseline.databaseBytes[scale])}, measured ${String(actual.databaseBytes[scale])}`,
      );
    }
  }
  for (const key of expectedKeys.filter((key) => !(key in actual.operations))) {
    differences.push(`${key}: missing from benchmark report`);
  }
  for (const key of actualKeys.filter((key) => !(key in baseline.operations))) {
    differences.push(`${key}: missing from committed baseline`);
  }
  for (const key of actualKeys.filter((key) => key in baseline.operations)) {
    const expected = baseline.operations[key] as DeterministicD1Counters;
    const measured = actual.operations[key] as DeterministicD1Counters;
    for (const counter of ["statements", "rowsRead", "rowsWritten"] as const) {
      if (expected[counter] !== measured[counter]) {
        differences.push(
          `${key} ${counter}: expected ${expected[counter]}, measured ${measured[counter]}`,
        );
      }
    }
  }
  const expectedFocused = JSON.stringify(baseline.focusedOperations);
  const actualFocused = JSON.stringify(actual.focusedOperations);
  if (expectedFocused !== actualFocused) {
    differences.push("focused statement-group counters differ from the committed baseline");
  }
  if (differences.length > 0) {
    throw new Error(`Exact D1 cost baseline changed:\n${differences.join("\n")}`);
  }
}
