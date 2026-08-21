import { describe, expect, it, vi } from "vitest";
import { createLastValueAsyncCache } from "../../src/infrastructure/crypto-key-cache";

describe("last-value asynchronous cache", () => {
  it("reuses one promise for concurrent and later calls with the same value", async () => {
    const load = vi.fn((value: string) => Promise.resolve({ value }));
    const cache = createLastValueAsyncCache(load);

    const first = cache.get("first");
    const second = cache.get("first");

    expect(second).toBe(first);
    await expect(Promise.all([first, second, cache.get("first")])).resolves.toEqual([
      { value: "first" },
      { value: "first" },
      { value: "first" },
    ]);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("rotates when the configured value changes", async () => {
    const load = vi.fn((value: string) => Promise.resolve(value.toUpperCase()));
    const cache = createLastValueAsyncCache(load);

    await expect(cache.get("first")).resolves.toBe("FIRST");
    await expect(cache.get("second")).resolves.toBe("SECOND");

    expect(load).toHaveBeenCalledTimes(2);
  });

  it("retries a rejected load for the current value", async () => {
    const load = vi
      .fn<(value: string) => Promise<string>>()
      .mockRejectedValueOnce(new Error("import failed"))
      .mockResolvedValueOnce("loaded");
    const cache = createLastValueAsyncCache(load);

    await expect(cache.get("first")).rejects.toThrow("import failed");
    await expect(cache.get("first")).resolves.toBe("loaded");

    expect(load).toHaveBeenCalledTimes(2);
  });
});
