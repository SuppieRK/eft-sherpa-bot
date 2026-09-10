import { D1MvpRepository } from "../cloudflare/d1-mvp-repository";
import type { CloudflareEnvironment } from "../cloudflare/environment";
import { scheduleBackground, type TrackedExecutionContext } from "../cloudflare/telemetry";

export async function executeDiscordMutation<T>(
  input: {
    repository: D1MvpRepository;
    environment: CloudflareEnvironment;
    context?: ExecutionContext | TrackedExecutionContext;
    changedAt: Date;
    deliveryId: string;
    eventType: string;
  },
  action: () => Promise<T>,
): Promise<{ outcome: "duplicate" } | { outcome: "completed"; value: T }> {
  const { repository, deliveryId, changedAt } = input;
  const token = await repository.claimDiscordMutation(
    deliveryId,
    input.eventType,
    changedAt,
    new Date(),
  );
  if (token === undefined) return { outcome: "duplicate" };

  let value: T;
  try {
    value = await action();
  } catch (error) {
    await repository.releaseDiscordMutation(deliveryId, token);
    throw error;
  }

  // The action succeeded. A completion error must leave its claim pending until lease expiry.
  await repository.completeDiscordMutation(deliveryId, token);
  scheduleBackground(
    input.context,
    "discord.receipt_cleanup",
    input.environment,
    async (environment) => {
      await new D1MvpRepository(environment.DB).maintainExpiredReceipts(changedAt);
    },
  );
  return { outcome: "completed", value };
}
