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
}

export interface D1CostBaseline {
  schemaVersion: 1;
  operations: Record<string, DeterministicD1Counters>;
}

export function baselineKey(scale: number, operationId: UserOperationId): string {
  return `${scale}:${operationId}`;
}

export function createD1CostBaseline(report: {
  results: readonly BenchmarkResultLike[];
}): D1CostBaseline {
  const operations: Record<string, DeterministicD1Counters> = {};
  for (const result of report.results) {
    operations[baselineKey(result.scale, result.id)] = {
      statements: result.aggregate.statements.median,
      rowsRead: result.aggregate.rowsRead.median,
      rowsWritten: result.aggregate.rowsWritten.median,
    };
  }
  return { schemaVersion: 1, operations };
}

export function assertExactD1Baseline(
  report: { results: readonly BenchmarkResultLike[] },
  baseline: D1CostBaseline,
): void {
  const actual = createD1CostBaseline(report);
  const expectedKeys = Object.keys(baseline.operations).sort();
  const actualKeys = Object.keys(actual.operations).sort();
  const differences: string[] = [];
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
  if (differences.length > 0) {
    throw new Error(`Exact D1 cost baseline changed:\n${differences.join("\n")}`);
  }
}
