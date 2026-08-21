export interface D1Usage {
  bindingCalls: number;
  statements: number;
  durationMs: number;
  rowsRead: number;
  rowsWritten: number;
}

export interface D1StatementUsage extends D1Usage {
  queryId: string;
}

export class D1Metrics {
  readonly #usage: D1Usage = {
    bindingCalls: 0,
    statements: 0,
    durationMs: 0,
    rowsRead: 0,
    rowsWritten: 0,
  };
  readonly #statements: D1StatementUsage[] | undefined;

  constructor(captureStatements = false) {
    this.#statements = captureStatements ? [] : undefined;
  }

  record(result: D1Result, queryId = "unknown"): void {
    const usage = {
      bindingCalls: 0,
      statements: 1,
      durationMs: Number(result.meta.duration ?? 0),
      rowsRead: Number(result.meta.rows_read ?? 0),
      rowsWritten: Number(result.meta.rows_written ?? 0),
    };
    this.#usage.statements += 1;
    this.#usage.durationMs += usage.durationMs;
    this.#usage.rowsRead += usage.rowsRead;
    this.#usage.rowsWritten += usage.rowsWritten;
    this.#statements?.push({ queryId, ...usage });
  }

  recordBindingCall(): void {
    this.#usage.bindingCalls += 1;
  }

  add(usage: Readonly<D1Usage>): void {
    this.#usage.bindingCalls += usage.bindingCalls;
    this.#usage.statements += usage.statements;
    this.#usage.durationMs += usage.durationMs;
    this.#usage.rowsRead += usage.rowsRead;
    this.#usage.rowsWritten += usage.rowsWritten;
  }

  snapshot(): Readonly<D1Usage> {
    return { ...this.#usage };
  }

  statementDetails(): readonly Readonly<D1StatementUsage>[] {
    return this.#statements?.map((statement) => ({ ...statement })) ?? [];
  }
}

const originalStatements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
const statementQueryIds = new WeakMap<D1PreparedStatement, string>();
const queryTextEncoder = new TextEncoder();

function stableQueryId(query: string): string {
  const explicit = /^\s*\/\*\s*d1:([a-z0-9._-]+)\s*\*\//i.exec(query)?.[1];
  if (explicit !== undefined) return explicit;
  let hash = 2_166_136_261;
  for (const byte of queryTextEncoder.encode(query.replaceAll(/\s+/g, " ").trim())) {
    hash = Math.imul(hash ^ byte, 16_777_619);
  }
  return `sql.${(hash >>> 0).toString(16)}`;
}

class InstrumentedStatement implements D1PreparedStatement {
  constructor(
    private readonly statement: D1PreparedStatement,
    private readonly metrics: D1Metrics,
    private readonly queryId: string,
  ) {
    originalStatements.set(this, statement);
    statementQueryIds.set(this, queryId);
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new InstrumentedStatement(this.statement.bind(...values), this.metrics, this.queryId);
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    const result = await this.statement.all<Record<string, unknown>>();
    this.metrics.recordBindingCall();
    this.metrics.record(result, this.queryId);
    const row = result.results[0];
    if (row === undefined) {
      return null;
    }
    if (columnName === undefined) {
      return row as T;
    }
    if (!(columnName in row)) {
      throw new Error(`Column not found: ${columnName}`);
    }
    return row[columnName] as T;
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.statement.run<T>();
    this.metrics.recordBindingCall();
    this.metrics.record(result, this.queryId);
    return result;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.statement.all<T>();
    this.metrics.recordBindingCall();
    this.metrics.record(result, this.queryId);
    return result;
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const result = await this.statement.all<Record<string, unknown>>();
    this.metrics.recordBindingCall();
    this.metrics.record(result, this.queryId);
    const columnNames = Object.keys(result.results[0] ?? {});
    const rows = result.results.map((row) => columnNames.map((column) => row[column])) as T[];
    return options?.columnNames === true ? [columnNames, ...rows] : rows;
  }
}

export function instrumentD1Database(database: D1Database, metrics: D1Metrics): D1Database {
  return new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) =>
          new InstrumentedStatement(target.prepare(query), metrics, stableQueryId(query));
      }
      if (property === "batch") {
        return async <T>(statements: D1PreparedStatement[]) => {
          metrics.recordBindingCall();
          const results = await target.batch<T>(
            statements.map((statement) => originalStatements.get(statement) ?? statement),
          );
          for (const [index, result] of results.entries()) {
            metrics.record(
              result,
              statementQueryIds.get(statements[index] as D1PreparedStatement) ?? "unknown",
            );
          }
          return results;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
