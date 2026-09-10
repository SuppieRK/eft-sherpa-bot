import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { afterEach, expect, it, vi } from "vitest";
import { D1MvpRepository } from "../../src/infrastructure/cloudflare/d1-mvp-repository";
import type { CloudflareEnvironment } from "../../src/infrastructure/cloudflare/environment";
import { observeWorkerRequest } from "../../src/infrastructure/cloudflare/telemetry";
import { executeDiscordMutation } from "../../src/infrastructure/discord/mutation-lifecycle";

afterEach(() => vi.restoreAllMocks());

it("retains a claim after a real D1 completion failure and reclaims it only after expiry", async () => {
  const input = {
    repository: new D1MvpRepository(env.DB),
    environment: env as CloudflareEnvironment,
    deliveryId: "completion-fault",
    eventType: "test:mutation",
    changedAt: new Date(Date.now() - 60_000),
  };
  const action = vi.fn(() => Promise.resolve("saved"));
  const cleanup = vi.spyOn(D1MvpRepository.prototype, "maintainExpiredReceipts");
  await env.DB.prepare(
    `CREATE TRIGGER test_receipt_completion_failure BEFORE UPDATE OF discord_mutation_status ON event_receipts
     WHEN NEW.discord_mutation_status = 1 BEGIN SELECT RAISE(ABORT, 'completion fault'); END`,
  ).run();
  try {
    await expect(executeDiscordMutation(input, action)).rejects.toThrow("completion fault");
  } finally {
    await env.DB.prepare("DROP TRIGGER test_receipt_completion_failure").run();
  }
  const receipt = await env.DB.prepare(
    "SELECT discord_claim_token AS token, discord_claim_until AS expires FROM event_receipts WHERE delivery_id = ?",
  )
    .bind(input.deliveryId)
    .first<{ token: string; expires: number }>();
  expect(receipt?.token).toEqual(expect.any(String));
  expect(receipt?.expires).toBeGreaterThan(input.changedAt.getTime() + 5 * 60_000);
  await expect(executeDiscordMutation(input, action)).resolves.toEqual({ outcome: "duplicate" });
  expect(action).toHaveBeenCalledTimes(1);
  expect(cleanup).not.toHaveBeenCalled();

  // Model an expired wall-clock lease without delaying the test for five minutes.
  await env.DB.prepare("UPDATE event_receipts SET discord_claim_until = ? WHERE delivery_id = ?")
    .bind(Date.now() - 1, input.deliveryId)
    .run();
  const context = createExecutionContext();
  await expect(executeDiscordMutation({ ...input, context }, action)).resolves.toEqual({
    outcome: "completed",
    value: "saved",
  });
  await waitOnExecutionContext(context);
  expect(action).toHaveBeenCalledTimes(2);
  expect(cleanup).toHaveBeenCalledTimes(1);
  // The old token cannot remove the completed receipt.
  await input.repository.releaseDiscordMutation(input.deliveryId, receipt?.token ?? "missing");
  await expect(executeDiscordMutation(input, action)).resolves.toEqual({ outcome: "duplicate" });
  expect(action).toHaveBeenCalledTimes(2);
});

it("attributes receipt cleanup to the measured background environment", async () => {
  const logs = vi.spyOn(console, "info").mockImplementation(() => undefined);
  const context = createExecutionContext();
  const response = await observeWorkerRequest(
    new Request("https://worker.test/webhooks/discord/interactions", { method: "POST" }),
    env as CloudflareEnvironment,
    context,
    async (environment, tracked) => {
      const result = await executeDiscordMutation(
        {
          environment,
          context: tracked,
          repository: new D1MvpRepository(environment.DB),
          changedAt: new Date(),
          deliveryId: "measured-receipt",
          eventType: "test:mutation",
        },
        () => environment.DB.prepare("SELECT 1 AS value").first(),
      );
      return Response.json(result);
    },
  );
  expect(await response.json()).toMatchObject({ outcome: "completed", value: { value: 1 } });
  await waitOnExecutionContext(context);
  const events = logs.mock.calls.map(([line]) => JSON.parse(String(line)));
  expect(events).toContainEqual(
    expect.objectContaining({
      code: "worker_invocation",
      d1Statements: 3,
      d1BindingCalls: 3,
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      code: "worker_background_task",
      task: "discord.receipt_cleanup",
      d1Statements: 1,
      d1BindingCalls: 1,
    }),
  );
  expect(events).toContainEqual(
    expect.objectContaining({
      code: "worker_invocation_final",
      trackedTaskCount: 1,
      d1Statements: 4,
      d1BindingCalls: 4,
    }),
  );
});
