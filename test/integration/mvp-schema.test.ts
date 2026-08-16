import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { TARKOV_MAPS } from "../../src/domain/maps/catalog";

const now = "2096-08-15T20:00:00.000Z";
const nowEpoch = Date.parse(now);

async function insertMapping(login: string, id: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO user_mappings
       (twitch_login, twitch_user_id, created_at, updated_at)
     VALUES (?, ?, ?, ?)`,
  )
    .bind(login, id, nowEpoch, nowEpoch)
    .run();
}

describe("six-table dual-queue schema", () => {
  it("contains exactly six application tables", async () => {
    const result = await env.DB.prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%'
         AND name <> 'd1_migrations'
       ORDER BY name`,
    ).all<{ name: string }>();
    expect(result.results.map((row) => row.name)).toEqual(
      [
        "event_receipts",
        "help_requests",
        "raid_group_members",
        "raid_groups",
        "community_state",
        "user_mappings",
      ].sort(),
    );
  });

  it("stores compact queue, attempt, message, and call state without retry machinery", async () => {
    const requestColumns = await env.DB.prepare(`PRAGMA table_info(help_requests)`).all<{
      name: string;
    }>();
    const groupColumns = await env.DB.prepare(`PRAGMA table_info(raid_groups)`).all<{
      name: string;
    }>();
    const stateColumns = await env.DB.prepare(`PRAGMA table_info(community_state)`).all<{
      name: string;
    }>();
    expect(requestColumns.results.map((column) => column.name)).toContain("is_priority");
    expect(requestColumns.results.map((column) => column.name)).not.toContain(
      "retry_source_group_id",
    );
    expect(groupColumns.results.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "attempt_count",
        "automatic_fill",
        "discord_call_status",
        "twitch_call_status",
        "staff_message_id",
        "is_priority",
        "sort_key",
        "current_member_count",
      ]),
    );
    expect(stateColumns.results.map((column) => column.name)).toContain("staff_board_message_id");
    expect(stateColumns.results.map((column) => column.name)).toEqual(
      expect.arrayContaining(["priority_open_raid_count", "ordinary_open_raid_count"]),
    );
  });

  it("has the required active-request and ordered-group indexes", async () => {
    const indexes = await env.DB.prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'index' AND name IN (
         'help_requests_one_active_map_per_twitch',
         'help_requests_queue_order_idx',
         'help_requests_waiting_order_idx',
         'raid_groups_outstanding_idx',
         'raid_groups_open_sort_key_idx',
         'raid_groups_compatible_idx',
         'raid_group_members_group_idx',
         'raid_group_members_one_open_request_idx'
       ) ORDER BY name`,
    ).all<{ name: string }>();
    expect(indexes.results.map((index) => index.name)).toHaveLength(8);
    const retired = await env.DB.prepare(
      `SELECT name FROM sqlite_schema WHERE type = 'index' AND name IN (
         'help_requests_map_queue_order_idx',
         'help_requests_retry_source_idx',
         'help_requests_discord_idx',
         'help_requests_twitch_idx'
       )`,
    ).all<{ name: string }>();
    expect(retired.results).toEqual([]);
  });

  it("uses dedicated indexes for compatible raids and historical group membership", async () => {
    const compatiblePlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT id FROM raid_groups
       WHERE is_priority = 0 AND map_id = 'customs' AND state = 0 AND automatic_fill = 1
         AND current_member_count < requester_capacity
       ORDER BY sort_key LIMIT 1`,
    ).all<{ detail: string }>();
    const membershipPlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT request_id FROM raid_group_members WHERE group_id = 1 ORDER BY position`,
    ).all<{ detail: string }>();
    expect(compatiblePlan.results.map((row) => row.detail).join(" ")).toContain(
      "raid_groups_compatible_idx",
    );
    expect(membershipPlan.results.map((row) => row.detail).join(" ")).toContain(
      "raid_group_members_group_idx",
    );
  });

  it("uses ordered indexes for queue ranges and open-queue maxima", async () => {
    const requestPlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT count(*) FROM (
         SELECT id, is_priority AS isPriority FROM help_requests
         WHERE state IN (0, 1) AND is_priority = 1
         UNION ALL
         SELECT id, is_priority AS isPriority FROM help_requests
         WHERE state IN (0, 1) AND is_priority = 0 AND id < 50000
         ORDER BY isPriority DESC, id LIMIT 101
       )`,
    ).all<{ detail: string }>();
    const raidRangePlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT count(*) FROM (
         SELECT sort_key AS sortKey, is_priority AS isPriority FROM raid_groups
         WHERE state IN (0, 1) AND is_priority = 1
         UNION ALL
         SELECT sort_key AS sortKey, is_priority AS isPriority FROM raid_groups
         WHERE state IN (0, 1) AND is_priority = 0 AND sort_key < 50000000
         ORDER BY isPriority DESC, sortKey LIMIT 51
       )`,
    ).all<{ detail: string }>();
    const raidMaxPlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT sort_key FROM raid_groups
       WHERE is_priority = 0 AND state IN (0, 1)
       ORDER BY sort_key DESC LIMIT 1`,
    ).all<{ detail: string }>();
    expect(requestPlan.results.map((row) => row.detail).join(" ")).toContain(
      "help_requests_queue_order_idx",
    );
    expect(raidRangePlan.results.map((row) => row.detail).join(" ")).toContain(
      "raid_groups_open_sort_key_idx",
    );
    expect(raidMaxPlan.results.map((row) => row.detail).join(" ")).toContain(
      "raid_groups_open_sort_key_idx",
    );
  });

  it("does not store derived request references or queue sequence", async () => {
    const columns = await env.DB.prepare(`PRAGMA table_info(help_requests)`).all<{
      name: string;
    }>();
    expect(columns.results.map((column) => column.name)).not.toEqual(
      expect.arrayContaining(["reference", "queue_sequence"]),
    );
  });

  it("stores finite states and timestamps as integers", async () => {
    await insertMapping("compact", "compact-id");
    await env.DB.prepare(
      `INSERT INTO help_requests
         (source_platform, source_delivery_id, twitch_user_id, twitch_login, in_game_name,
          map_id, objective, created_at, updated_at)
       VALUES (1, 'compact', 'compact-id', 'compact', 'PMC', 'customs', 'Task', ?, ?)`,
    )
      .bind(nowEpoch, nowEpoch)
      .run();
    const stored = await env.DB.prepare(
      `SELECT typeof(source_platform) AS platformType, typeof(state) AS stateType,
              typeof(created_at) AS timestampType FROM help_requests WHERE source_delivery_id = 'compact'`,
    ).first<{ platformType: string; stateType: string; timestampType: string }>();
    expect(stored).toEqual({
      platformType: "integer",
      stateType: "integer",
      timestampType: "integer",
    });
  });

  it("does not accept the removed Try Again outcome code", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO raid_groups
           (is_priority, sort_key, map_id, requester_capacity, state, outcome,
            completed_at, created_at, updated_at)
         VALUES (0, 1000000, 'customs', 3, 2, 2, ?, ?, ?)`,
      )
        .bind(nowEpoch, nowEpoch, nowEpoch)
        .run(),
    ).rejects.toThrow();
  });

  it("rejects missing identity and out-of-range objective or notes", async () => {
    await insertMapping("viewer", "twitch-viewer");
    await expect(
      env.DB.prepare(
        `INSERT INTO help_requests
           (source_platform, source_delivery_id, twitch_login, in_game_name,
            map_id, objective, created_at, updated_at)
         VALUES (0, 'missing-id', 'viewer', 'PMC', 'customs', 'Task', ?, ?)`,
      )
        .bind(nowEpoch, nowEpoch)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        `INSERT INTO help_requests
           (source_platform, source_delivery_id, twitch_user_id, twitch_login, in_game_name,
            map_id, objective, created_at, updated_at)
         VALUES (1, 'long-goal', 'twitch-viewer', 'viewer', 'PMC', 'customs', ?, ?, ?)`,
      )
        .bind("x".repeat(151), nowEpoch, nowEpoch)
        .run(),
    ).rejects.toThrow();
    await expect(
      env.DB.prepare(
        `INSERT INTO help_requests
           (source_platform, source_delivery_id, twitch_user_id, twitch_login, in_game_name,
            map_id, objective, notes, created_at, updated_at)
         VALUES (1, 'long-notes', 'twitch-viewer', 'viewer', 'PMC', 'customs',
                 'Task', ?, ?, ?)`,
      )
        .bind("n".repeat(251), nowEpoch, nowEpoch)
        .run(),
    ).rejects.toThrow();
  });

  it("allows only one active request per Twitch login and map", async () => {
    await insertMapping("viewer", "twitch-viewer");
    const insert = (delivery: string) =>
      env.DB.prepare(
        `INSERT INTO help_requests
           (source_platform, source_delivery_id, twitch_user_id, twitch_login,
            in_game_name, map_id, objective, created_at, updated_at)
         VALUES (1, ?, 'twitch-viewer', 'viewer', 'viewer', 'customs', 'Task', ?, ?)`,
      )
        .bind(delivery, nowEpoch, nowEpoch)
        .run();
    await insert("one");
    await expect(insert("two")).rejects.toThrow();
    await env.DB.prepare(`UPDATE help_requests SET state = 2`).run();
    await expect(insert("three")).resolves.toBeDefined();
  });

  it.each(TARKOV_MAPS)("enforces the $name requester capacity", async (map) => {
    const requesterCapacity = map.sherpaPartyCapacity - 1;
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO raid_groups
           (id, is_priority, sort_key, map_id, requester_capacity, created_at, updated_at)
         VALUES (1, 0, 1000000, ?, ?, ?, ?)`,
      ).bind(map.id, requesterCapacity, nowEpoch, nowEpoch),
    ]);
    await expect(
      env.DB.prepare(
        `INSERT INTO raid_groups
           (id, is_priority, sort_key, map_id, requester_capacity, created_at, updated_at)
         VALUES (2, 0, 2000000, ?, ?, ?, ?)`,
      )
        .bind(map.id, requesterCapacity + 1, nowEpoch, nowEpoch)
        .run(),
    ).rejects.toThrow();
    for (let id = 1; id <= requesterCapacity + 1; id += 1) {
      await insertMapping(`viewer_${id}`, `twitch-${id}`);
      await env.DB.prepare(
        `INSERT INTO help_requests
           (id, source_platform, source_delivery_id, twitch_user_id, twitch_login,
            in_game_name, map_id, objective, state, created_at, updated_at)
         VALUES (?, 1, ?, ?, ?, 'PMC', ?, 'Task', 1, ?, ?)`,
      )
        .bind(id, `request-${id}`, `twitch-${id}`, `viewer_${id}`, map.id, nowEpoch, nowEpoch)
        .run();
    }
    for (let id = 1; id <= requesterCapacity; id += 1) {
      await env.DB.prepare(
        `INSERT INTO raid_group_members
           (group_id, request_id, position, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?)`,
      )
        .bind(id, id, nowEpoch, nowEpoch)
        .run();
    }
    await expect(
      env.DB.prepare(
        `INSERT INTO raid_group_members
           (group_id, request_id, position, created_at, updated_at)
         VALUES (1, ?, ?, ?, ?)`,
      )
        .bind(requesterCapacity + 1, requesterCapacity + 1, nowEpoch, nowEpoch)
        .run(),
    ).rejects.toThrow("raid group capacity exceeded");
    expect(
      await env.DB.prepare(
        `SELECT current_member_count AS count FROM raid_groups WHERE id = 1`,
      ).first<{ count: number }>(),
    ).toEqual({ count: requesterCapacity });
  });

  it("rejects maps outside the committed catalog", async () => {
    await expect(
      env.DB.prepare(
        `INSERT INTO raid_groups
           (is_priority, sort_key, map_id, requester_capacity, created_at, updated_at)
         VALUES (0, 1000000, 'unknown-map', 1, ?, ?)`,
      )
        .bind(nowEpoch, nowEpoch)
        .run(),
    ).rejects.toThrow();
  });

  it("keeps current membership counts synchronized across every membership transition", async () => {
    await env.DB.prepare(
      `INSERT OR IGNORE INTO community_state (community_id, created_at, updated_at)
       VALUES ('butcoffee', ?, ?)`,
    )
      .bind(nowEpoch, nowEpoch)
      .run();
    await env.DB.prepare(
      `INSERT INTO raid_groups
         (id, is_priority, sort_key, map_id, requester_capacity, created_at, updated_at)
       VALUES (1, 0, 1000000, 'customs', 3, ?, ?),
              (2, 0, 2000000, 'customs', 3, ?, ?)`,
    )
      .bind(nowEpoch, nowEpoch, nowEpoch, nowEpoch)
      .run();
    for (let id = 1; id <= 2; id += 1) {
      await insertMapping(`counter_${id}`, `counter-${id}`);
      await env.DB.prepare(
        `INSERT INTO help_requests
           (id, source_platform, source_delivery_id, twitch_user_id, twitch_login,
            in_game_name, map_id, objective, state, created_at, updated_at)
         VALUES (?, 1, ?, ?, ?, 'PMC', 'customs', 'Task', 1, ?, ?)`,
      )
        .bind(id, `counter-request-${id}`, `counter-${id}`, `counter_${id}`, nowEpoch, nowEpoch)
        .run();
    }
    await env.DB.prepare(
      `INSERT INTO raid_group_members
         (id, group_id, request_id, position, created_at, updated_at)
       VALUES (1, 1, 1, 1, ?, ?), (2, 1, 2, 2, ?, ?)`,
    )
      .bind(nowEpoch, nowEpoch, nowEpoch, nowEpoch)
      .run();

    const counts = async () =>
      (
        await env.DB.prepare(
          `SELECT id, current_member_count AS count FROM raid_groups ORDER BY id`,
        ).all<{ id: number; count: number }>()
      ).results;
    expect(await counts()).toEqual([
      { id: 1, count: 2 },
      { id: 2, count: 0 },
    ]);

    await env.DB.prepare(`UPDATE raid_group_members SET group_id = 2 WHERE id = 2`).run();
    expect(await counts()).toEqual([
      { id: 1, count: 1 },
      { id: 2, count: 1 },
    ]);

    await env.DB.prepare(`UPDATE raid_group_members SET state = 1 WHERE id = 1`).run();
    expect(await counts()).toEqual([
      { id: 1, count: 0 },
      { id: 2, count: 1 },
    ]);

    await env.DB.prepare(
      `UPDATE raid_group_members SET state = 0, group_id = 2 WHERE id = 1`,
    ).run();
    expect(await counts()).toEqual([
      { id: 1, count: 0 },
      { id: 2, count: 2 },
    ]);

    await env.DB.prepare(`DELETE FROM raid_group_members WHERE id = 2`).run();
    expect(await counts()).toEqual([
      { id: 1, count: 0 },
      { id: 2, count: 1 },
    ]);

    await env.DB.prepare(`UPDATE raid_groups SET is_priority = 1 WHERE id = 1`).run();
    await env.DB.prepare(`DELETE FROM raid_groups WHERE id = 2`).run();
    expect(
      await env.DB.prepare(
        `SELECT priority_open_raid_count AS priorityCount,
                ordinary_open_raid_count AS ordinaryCount
         FROM community_state WHERE community_id = 'butcoffee'`,
      ).first<{ priorityCount: number; ordinaryCount: number }>(),
    ).toEqual({ priorityCount: 1, ordinaryCount: 0 });
  });
});
