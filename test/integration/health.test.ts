import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("Worker health endpoint", () => {
  it("reports the configured environment", async () => {
    const response = await exports.default.fetch("http://example.com/health");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "ok",
      environment: "local",
      configuration: "ready",
    });
  });

  it("does not expose an accidental route", async () => {
    const response = await exports.default.fetch("http://example.com/private");
    expect(response.status).toBe(404);
  });

  it("does not expose the removed Twitch schedule refresh route", async () => {
    const response = await exports.default.fetch("http://example.com/internal/schedule/refresh", {
      method: "POST",
    });
    expect(response.status).toBe(404);
  });
});
