import { describe, expect, it, vi } from "vitest";
import { D1Metrics, instrumentD1Database } from "../../src/infrastructure/cloudflare/d1-metrics";

describe("D1 instrumentation", () => {
  it("counts a standalone binding call that rejects before returning result metadata", async () => {
    const all = vi.fn().mockRejectedValue(new Error("d1_rejected"));
    const statement = { all, bind: vi.fn() } as unknown as D1PreparedStatement;
    const database = {
      prepare: vi.fn().mockReturnValue(statement),
    } as unknown as D1Database;
    const metrics = new D1Metrics(true);
    const measured = instrumentD1Database(database, metrics);

    await expect(measured.prepare("SELECT 1").all()).rejects.toThrow("d1_rejected");

    expect(metrics.snapshot()).toMatchObject({ bindingCalls: 1, statements: 0 });
    expect(metrics.statementDetails()).toEqual([]);
  });
});
