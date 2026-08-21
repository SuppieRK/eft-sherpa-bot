import { env } from "cloudflare:workers";
import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, expect, it, vi } from "vitest";
import { observeWorkerRequest } from "../../src/infrastructure/cloudflare/telemetry";
import type { CloudflareEnvironment } from "../../src/infrastructure/cloudflare/environment";

afterEach(() => vi.restoreAllMocks());

function parsedLogs(spy: { mock: { calls: unknown[][] } }): Record<string, unknown>[] {
  return spy.mock.calls.map((call) => JSON.parse(String(call[0])) as Record<string, unknown>);
}

it("reports independent foreground, background, and final D1 usage", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const context = createExecutionContext();
  const response = await observeWorkerRequest(
    new Request("https://worker.test/internal/status"),
    env as CloudflareEnvironment,
    context,
    async (environment, tracked) => {
      await environment.DB.batch([
        environment.DB.prepare("SELECT 1 AS value"),
        environment.DB.prepare("SELECT 2 AS value"),
      ]);
      tracked.waitUntilTask("test.background", async (background) => {
        await background.DB.prepare("SELECT 3 AS value").first();
      });
      return new Response(null, { status: 204 });
    },
  );
  expect(response.status).toBe(204);
  await waitOnExecutionContext(context);

  const logs = parsedLogs(info);
  const foreground = logs.find((entry) => entry.code === "worker_invocation");
  const background = logs.find((entry) => entry.code === "worker_background_task");
  const final = logs.find((entry) => entry.code === "worker_invocation_final");
  expect(foreground).toMatchObject({
    scope: "foreground",
    d1BindingCalls: 1,
    d1Statements: 2,
  });
  expect(background).toMatchObject({
    task: "test.background",
    outcome: "ok",
    d1BindingCalls: 1,
    d1Statements: 1,
  });
  expect(final).toMatchObject({
    trackedTaskCount: 1,
    d1BindingCalls: 2,
    d1Statements: 3,
  });
  expect(background?.correlationId).toBe(foreground?.correlationId);
  expect(final?.correlationId).toBe(foreground?.correlationId);
  expect(JSON.stringify(logs)).not.toContain("SELECT 3");
});

it("reports a safe background failure without changing the response", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const context = createExecutionContext();
  const response = await observeWorkerRequest(
    new Request("https://worker.test/health"),
    env as CloudflareEnvironment,
    context,
    (_environment, tracked) => {
      tracked.waitUntilTask("test.failure", () =>
        Promise.reject(new Error("private requester text")),
      );
      return Promise.resolve(Response.json({ status: "ok" }));
    },
  );
  expect(response.status).toBe(200);
  await waitOnExecutionContext(context);

  expect(parsedLogs(error)).toContainEqual(
    expect.objectContaining({
      code: "worker_background_task",
      task: "test.failure",
      outcome: "exception",
      errorCode: "unexpected_error",
    }),
  );
  expect(JSON.stringify([...parsedLogs(info), ...parsedLogs(error)])).not.toContain(
    "private requester text",
  );
});

it("emits final usage after a foreground exception", async () => {
  const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
  const context = createExecutionContext();

  await expect(
    observeWorkerRequest(
      new Request("https://worker.test/internal/status"),
      env as CloudflareEnvironment,
      context,
      async (environment, tracked) => {
        await environment.DB.prepare("SELECT 1 AS value").first();
        tracked.waitUntilTask("test.before_exception", async (background) => {
          await background.DB.prepare("SELECT 2 AS value").first();
        });
        throw new Error("private failure details");
      },
    ),
  ).rejects.toThrow("private failure details");
  await waitOnExecutionContext(context);

  const final = parsedLogs(info).find((entry) => entry.code === "worker_invocation_final");
  expect(final).toMatchObject({
    outcome: "exception",
    trackedTaskCount: 1,
    d1BindingCalls: 2,
    d1Statements: 2,
  });
  expect(JSON.stringify([...parsedLogs(info), ...parsedLogs(error)])).not.toContain(
    "private failure details",
  );
});
