import { env } from "cloudflare:workers";
import { createExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorker } from "../../src";
import type { CloudflareEnvironment } from "../../src/infrastructure/cloudflare/environment";
import { testCommunityConfig } from "../fixtures/community";

const environment = env as CloudflareEnvironment;
const worker = createWorker(testCommunityConfig);

afterEach(() => vi.restoreAllMocks());

async function seedLegacyRequests(count: number): Promise<void> {
  const rows = JSON.stringify(
    Array.from({ length: count }, (_, offset) => ({
      id: offset + 1,
      login: `legacy_${offset + 1}`,
    })),
  );
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user_mappings
         (twitch_login, twitch_user_id, created_at, updated_at)
       SELECT json_extract(value, '$.login'), 'legacy-twitch-' || json_extract(value, '$.id'), 0, 0
       FROM json_each(?)`,
    ).bind(rows),
    env.DB.prepare(
      `INSERT INTO help_requests
         (source_platform, source_delivery_id, twitch_user_id, twitch_login, in_game_name,
          game_mode, map_id, objective, created_at, updated_at)
       SELECT 1, 'legacy-delivery-' || json_extract(value, '$.id'),
              'legacy-twitch-' || json_extract(value, '$.id'),
              json_extract(value, '$.login'), 'Legacy PMC', 2, 'customs', 'Legacy task', 0, 0
       FROM json_each(?)`,
    ).bind(rows),
  ]);
}

function repairRequest(token?: string): Request {
  return new Request("https://example.com/internal/repair-unassigned-requests", {
    method: "POST",
    ...(token === undefined ? {} : { headers: { Authorization: `Bearer ${token}` } }),
  });
}

describe("protected legacy request repair", () => {
  it("hides the operation from unauthorized callers", async () => {
    await seedLegacyRequests(1);
    const response = await worker.fetch(
      repairRequest("wrong-token"),
      environment,
      createExecutionContext(),
    );
    expect(response.status).toBe(404);
    await expect(env.DB.prepare(`SELECT state FROM help_requests`).first()).resolves.toEqual({
      state: 0,
    });
  });

  it("drains bounded batches and reports no remaining legacy request", async () => {
    await seedLegacyRequests(81);
    await env.DB.prepare(
      `INSERT INTO community_state
         (community_id, staff_board_message_id, created_at, updated_at)
       VALUES ('butcoffee', 'canonical-board', 0, 0)`,
    ).run();
    const discordFetch = vi.fn().mockResolvedValue(Response.json({ id: "canonical-board" }));
    const repairEnvironment = {
      ...environment,
      DISCORD_API_BASE_URL: "https://discord.test/api/v10",
      DISCORD_API_FETCHER: { fetch: discordFetch },
    } satisfies CloudflareEnvironment;
    const token = environment.SPIKE_DIAGNOSTICS_TOKEN;
    const first = await worker.fetch(
      repairRequest(token),
      repairEnvironment,
      createExecutionContext(),
    );
    expect(await first.json()).toEqual({ repaired: 80, hasMore: true });
    expect(discordFetch).not.toHaveBeenCalled();

    const second = await worker.fetch(
      repairRequest(token),
      repairEnvironment,
      createExecutionContext(),
    );
    expect(await second.json()).toEqual({ repaired: 1, hasMore: false });
    expect(discordFetch).toHaveBeenCalledTimes(1);
    expect(discordFetch.mock.calls[0]?.[1]?.method).toBe("PATCH");
    await expect(
      env.DB.prepare(
        `SELECT sum(state = 0) AS waiting, sum(state = 1) AS planned,
                (SELECT count(*) FROM raid_group_members WHERE state = 0) AS memberships
         FROM help_requests`,
      ).first(),
    ).resolves.toEqual({ waiting: 0, planned: 81, memberships: 81 });

    const status = await worker.fetch(
      new Request("https://example.com/internal/status", {
        headers: { Authorization: `Bearer ${token}` },
      }),
      environment,
      createExecutionContext(),
    );
    const statusBody = (await status.json()) as {
      database: { hasLegacyUnassignedRequests: boolean };
    };
    expect(statusBody.database).toMatchObject({
      hasLegacyUnassignedRequests: false,
    });
  });
});
