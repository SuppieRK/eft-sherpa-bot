export interface D1Usage {
  statements: number;
  durationMs: number;
  rowsRead: number;
  rowsWritten: number;
}

export interface D1StatementUsage extends D1Usage {
  query: string;
}

export class D1Metrics {
  readonly #usage: D1Usage = {
    statements: 0,
    durationMs: 0,
    rowsRead: 0,
    rowsWritten: 0,
  };
  readonly #statements: D1StatementUsage[] | undefined;

  constructor(captureStatements = false) {
    this.#statements = captureStatements ? [] : undefined;
  }

  record(result: D1Result, query = "unknown"): void {
    const usage = {
      statements: 1,
      durationMs: Number(result.meta.duration ?? 0),
      rowsRead: Number(result.meta.rows_read ?? 0),
      rowsWritten: Number(result.meta.rows_written ?? 0),
    };
    this.#usage.statements += 1;
    this.#usage.durationMs += usage.durationMs;
    this.#usage.rowsRead += usage.rowsRead;
    this.#usage.rowsWritten += usage.rowsWritten;
    this.#statements?.push({ query, ...usage });
  }

  snapshot(): Readonly<D1Usage> {
    return { ...this.#usage };
  }

  statementDetails(): readonly Readonly<D1StatementUsage>[] {
    return this.#statements?.map((statement) => ({ ...statement })) ?? [];
  }
}

const originalStatements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();
const statementQueries = new WeakMap<D1PreparedStatement, string>();

class InstrumentedStatement implements D1PreparedStatement {
  constructor(
    private readonly statement: D1PreparedStatement,
    private readonly metrics: D1Metrics,
    private readonly query: string,
  ) {
    originalStatements.set(this, statement);
    statementQueries.set(this, query);
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new InstrumentedStatement(this.statement.bind(...values), this.metrics, this.query);
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    const result = await this.statement.all<Record<string, unknown>>();
    this.metrics.record(result, this.query);
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
    this.metrics.record(result, this.query);
    return result;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.statement.all<T>();
    this.metrics.record(result, this.query);
    return result;
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const result = await this.statement.all<Record<string, unknown>>();
    this.metrics.record(result, this.query);
    const columnNames = Object.keys(result.results[0] ?? {});
    const rows = result.results.map((row) => columnNames.map((column) => row[column])) as T[];
    return options?.columnNames === true ? [columnNames, ...rows] : rows;
  }
}

export function instrumentD1Database(database: D1Database, metrics: D1Metrics): D1Database {
  return new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => new InstrumentedStatement(target.prepare(query), metrics, query);
      }
      if (property === "batch") {
        return async <T>(statements: D1PreparedStatement[]) => {
          const results = await target.batch<T>(
            statements.map((statement) => originalStatements.get(statement) ?? statement),
          );
          for (const [index, result] of results.entries()) {
            metrics.record(result, statementQueries.get(statements[index] as D1PreparedStatement));
          }
          return results;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
