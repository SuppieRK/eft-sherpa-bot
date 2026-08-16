export interface D1Usage {
  statements: number;
  durationMs: number;
  rowsRead: number;
  rowsWritten: number;
}

export class D1Metrics {
  readonly #usage: D1Usage = {
    statements: 0,
    durationMs: 0,
    rowsRead: 0,
    rowsWritten: 0,
  };

  record(result: D1Result): void {
    this.#usage.statements += 1;
    this.#usage.durationMs += Number(result.meta.duration ?? 0);
    this.#usage.rowsRead += Number(result.meta.rows_read ?? 0);
    this.#usage.rowsWritten += Number(result.meta.rows_written ?? 0);
  }

  snapshot(): Readonly<D1Usage> {
    return { ...this.#usage };
  }
}

const originalStatements = new WeakMap<D1PreparedStatement, D1PreparedStatement>();

class InstrumentedStatement implements D1PreparedStatement {
  constructor(
    private readonly statement: D1PreparedStatement,
    private readonly metrics: D1Metrics,
  ) {
    originalStatements.set(this, statement);
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new InstrumentedStatement(this.statement.bind(...values), this.metrics);
  }

  async first<T = unknown>(columnName?: string): Promise<T | null> {
    const result = await this.statement.all<Record<string, unknown>>();
    this.metrics.record(result);
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
    this.metrics.record(result);
    return result;
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const result = await this.statement.all<T>();
    this.metrics.record(result);
    return result;
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const result = await this.statement.all<Record<string, unknown>>();
    this.metrics.record(result);
    const columnNames = Object.keys(result.results[0] ?? {});
    const rows = result.results.map((row) => columnNames.map((column) => row[column])) as T[];
    return options?.columnNames === true ? [columnNames, ...rows] : rows;
  }
}

export function instrumentD1Database(database: D1Database, metrics: D1Metrics): D1Database {
  return new Proxy(database, {
    get(target, property) {
      if (property === "prepare") {
        return (query: string) => new InstrumentedStatement(target.prepare(query), metrics);
      }
      if (property === "batch") {
        return async <T>(statements: D1PreparedStatement[]) => {
          const results = await target.batch<T>(
            statements.map((statement) => originalStatements.get(statement) ?? statement),
          );
          for (const result of results) {
            metrics.record(result);
          }
          return results;
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
