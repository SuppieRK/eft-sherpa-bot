import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { D1Metrics, instrumentD1Database } from "../../src/infrastructure/cloudflare/d1-metrics";
import { D1MvpRepository } from "../../src/infrastructure/cloudflare/d1-mvp-repository";

it.each([10, 1_000, 10_000])(
  "postponement remains bounded after %i follow-ups close",
  async (count) => {
    const at = new Date("2096-08-15T21:00:00Z");
    const repo = new D1MvpRepository(env.DB);
    const requests = [];
    for (const index of [1, 2]) {
      requests.push(
        await repo.createRequest({
          sourcePlatform: "twitch",
          sourceDeliveryId: `history-${index}`,
          twitchUserId: `history-${index}`,
          twitchLogin: `history_${index}`,
          gameMode: "pve",
          inGameName: "PMC",
          mapId: "customs",
          objective: "Task",
          recipientLimit: 4,
          observedAt: at,
        }),
      );
    }
    const source = (await repo.getBoardSnapshot()).ordinaryRaids[0];
    const request = requests[0];
    if (!source || !request) throw new Error("Missing fixture");
    await repo.reviewRaid({ groupId: source.id, changedAt: at });
    await repo.setRaidStaffMessage(source.id, "history-source", at);
    await env.DB.prepare(`WITH RECURSIVE n(x) AS
    (SELECT 2 UNION ALL SELECT x + 1 FROM n WHERE x <= ?)
    INSERT INTO raid_groups(id, game_mode, sort_key, map_id, requester_capacity, created_at, updated_at)
    SELECT x, 2, x * 1000000, 'customs', 4, 10, 10 FROM n`)
      .bind(count)
      .run();
    await env.DB.prepare(`INSERT INTO raid_group_follow_ups
    SELECT ?, id, 10, 10 FROM raid_groups WHERE id <> ?`)
      .bind(source.id, source.id)
      .run();
    await env.DB.prepare(`UPDATE raid_groups SET state = 2, outcome = 1, completed_at = 20
    WHERE id <> ?`)
      .bind(source.id)
      .run();
    const metrics = new D1Metrics();
    const measured = new D1MvpRepository(instrumentD1Database(env.DB, metrics));
    const moved = await measured.postponeRequester({
      groupId: source.id,
      requestId: request.request.id,
      actionKey: "history-postpone",
      changedAt: at,
    });
    expect(moved.source.members).toHaveLength(1);
    expect(moved.dedicated.members.map((member) => member.requestId)).toEqual([request.request.id]);
    expect(metrics.snapshot().rowsRead).toBeLessThan(200);
    expect(metrics.snapshot().rowsWritten).toBeLessThan(80);
  },
);
