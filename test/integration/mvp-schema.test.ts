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

describe("nine-table dual-queue schema", () => {
  it("contains the seven operational tables and two statistics rollup tables", async () => {
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
        "raid_group_follow_ups",
        "raid_group_members",
        "raid_groups",
        "staff_leader_statistics",
        "staff_statistics_summary",
        "community_state",
        "user_mappings",
      ].sort(),
    );
  });

  it("installs the statistics rollup index and transactional maintenance triggers", async () => {
    const index = await env.DB.prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'index' AND name = 'staff_leader_statistics_rank_idx'`,
    ).first<{ name: string }>();
    const triggers = await env.DB.prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'trigger' AND name LIKE 'staff_statistics_%'
       ORDER BY name`,
    ).all<{ name: string }>();
    expect(index?.name).toBe("staff_leader_statistics_rank_idx");
    expect(triggers.results.map((trigger) => trigger.name)).toEqual([
      "staff_statistics_leader_delete",
      "staff_statistics_leader_insert",
      "staff_statistics_member_completed_delete",
      "staff_statistics_member_completed_insert",
      "staff_statistics_member_completed_update",
      "staff_statistics_raid_success_delete",
      "staff_statistics_raid_success_enter",
      "staff_statistics_raid_success_insert",
      "staff_statistics_raid_success_leave",
      "staff_statistics_raid_success_reassign",
      "staff_statistics_request_delete",
      "staff_statistics_request_insert",
      "staff_statistics_request_state_update",
    ]);
  });

  it("uses the ranking index for bounded staff leader reads", async () => {
    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT discord_user_id, helped_requests, successful_raids
       FROM staff_leader_statistics
       ORDER BY helped_requests DESC, successful_raids DESC, discord_user_id ASC
       LIMIT 10`,
    ).all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join(" ");
    expect(details).toContain("staff_leader_statistics_rank_idx");
    expect(details).not.toContain("USE TEMP B-TREE");
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
    expect(requestColumns.results.map((column) => column.name)).toContain("game_mode");
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
        "game_mode",
      ]),
    );
    expect(stateColumns.results.map((column) => column.name)).toContain("staff_board_message_id");
    expect(stateColumns.results.map((column) => column.name)).toEqual(
      expect.arrayContaining([
        "priority_open_raid_count",
        "ordinary_open_raid_count",
        "receipt_cleanup_after",
        "board_dirty_version",
        "board_rendered_version",
        "board_lease_until",
        "board_lease_token",
        "stable_identity_repair_count",
      ]),
    );
  });

  it("has the required active-request and ordered-group indexes", async () => {
    const indexes = await env.DB.prepare(
      `SELECT name FROM sqlite_schema
       WHERE type = 'index' AND name IN (
         'help_requests_one_active_map_per_twitch',
         'help_requests_one_active_mode_map_per_twitch',
         'help_requests_one_active_mode_map_per_twitch_id',
         'help_requests_mode_queue_order_idx',
         'help_requests_queue_order_idx',
         'help_requests_waiting_order_idx',
         'help_requests_waiting_mode_order_idx',
         'raid_groups_outstanding_idx',
         'raid_groups_open_sort_key_idx',
         'raid_groups_compatible_idx',
         'raid_groups_compatible_mode_idx',
         'raid_groups_pull_source_idx',
         'raid_groups_outstanding_mode_idx',
         'raid_group_members_group_idx',
         'raid_group_members_one_open_request_idx'
       ) ORDER BY name`,
    ).all<{ name: string }>();
    expect(indexes.results.map((index) => index.name)).toEqual(
      expect.arrayContaining([
        "help_requests_one_active_mode_map_per_twitch",
        "help_requests_one_active_mode_map_per_twitch_id",
        "help_requests_mode_queue_order_idx",
        "help_requests_waiting_order_idx",
        "help_requests_waiting_mode_order_idx",
        "raid_groups_outstanding_mode_idx",
        "raid_groups_open_sort_key_idx",
        "raid_groups_compatible_mode_idx",
        "raid_groups_pull_source_idx",
        "raid_group_members_group_idx",
        "raid_group_members_one_open_request_idx",
      ]),
    );
    const retired = await env.DB.prepare(
      `SELECT name FROM sqlite_schema WHERE type = 'index' AND name IN (
         'help_requests_map_queue_order_idx',
         'help_requests_retry_source_idx',
         'help_requests_discord_idx',
         'help_requests_twitch_idx'
         ,'help_requests_one_active_map_per_twitch'
         ,'raid_groups_compatible_idx'
         ,'help_requests_queue_order_idx'
         ,'help_requests_twitch_login_idx'
         ,'raid_groups_outstanding_idx'
       )`,
    ).all<{ name: string }>();
    expect(retired.results).toEqual([]);
  });

  it("uses dedicated indexes for compatible raids and historical group membership", async () => {
    const compatiblePlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT id FROM raid_groups
       WHERE is_priority = 0 AND game_mode = 2 AND map_id = 'customs'
         AND state = 0 AND automatic_fill = 1
         AND current_member_count < requester_capacity
       ORDER BY sort_key LIMIT 1`,
    ).all<{ detail: string }>();
    const membershipPlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT request_id FROM raid_group_members WHERE group_id = 1 ORDER BY position`,
    ).all<{ detail: string }>();
    expect(compatiblePlan.results.map((row) => row.detail).join(" ")).toContain(
      "raid_groups_compatible_mode_idx",
    );
    expect(membershipPlan.results.map((row) => row.detail).join(" ")).toContain(
      "raid_group_members_group_idx",
    );
  });

  it("uses the ordered pull-source index for full planned raids", async () => {
    const plan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT id FROM raid_groups
       WHERE is_priority = 0 AND game_mode = 2 AND map_id = 'customs'
         AND state = 0 AND automatic_fill = 1
         AND leader_discord_user_id IS NULL AND staff_message_id IS NULL
         AND current_member_count > 0 AND sort_key > 1000000
       ORDER BY sort_key LIMIT 1`,
    ).all<{ detail: string }>();
    const details = plan.results.map((row) => row.detail).join(" ");
    expect(details).toContain("raid_groups_pull_source_idx");
    expect(details).not.toContain("SCAN raid_groups");
    expect(details).not.toContain("USE TEMP B-TREE");
  });

  it("uses ordered indexes for queue ranges and open-queue maxima", async () => {
    const requestPlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT count(*) FROM (
         SELECT id, is_priority AS isPriority FROM help_requests
         WHERE state IN (0, 1) AND game_mode = 2 AND is_priority = 1
         UNION ALL
         SELECT id, is_priority AS isPriority FROM help_requests
         WHERE state IN (0, 1) AND game_mode = 2 AND is_priority = 0 AND id < 50000
         ORDER BY isPriority DESC, id LIMIT 101
       )`,
    ).all<{ detail: string }>();
    const raidRangePlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT id FROM raid_groups
       WHERE state IN (0, 1) AND is_priority = 0 AND game_mode = 2
       ORDER BY sort_key LIMIT 52`,
    ).all<{ detail: string }>();
    const raidMaxPlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT sort_key FROM raid_groups
       WHERE is_priority = 0 AND state IN (0, 1)
       ORDER BY sort_key DESC LIMIT 1`,
    ).all<{ detail: string }>();
    expect(requestPlan.results.map((row) => row.detail).join(" ")).toContain(
      "help_requests_mode_queue_order_idx",
    );
    expect(raidRangePlan.results.map((row) => row.detail).join(" ")).toContain(
      "raid_groups_outstanding_mode_idx",
    );
    expect(raidMaxPlan.results.map((row) => row.detail).join(" ")).toContain(
      "raid_groups_open_sort_key_idx",
    );
  });

  it("uses dedicated indexes for bounded waiting recovery and caller selection", async () => {
    const waitingFifoPlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT id FROM help_requests
       WHERE state = 0 ORDER BY is_priority DESC, id LIMIT 80`,
    ).all<{ detail: string }>();
    const waitingModePlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT id FROM help_requests
       WHERE state = 0 AND is_priority = 0 AND game_mode = 2
       ORDER BY id LIMIT 1`,
    ).all<{ detail: string }>();
    const callerPlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT id FROM help_requests
       WHERE twitch_login = 'viewer' AND state IN (0, 1)
       ORDER BY is_priority DESC, id LIMIT 1`,
    ).all<{ detail: string }>();
    const activeDuplicatePlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT id FROM help_requests
       WHERE twitch_login = 'viewer' AND game_mode = 2 AND map_id = 'customs'
         AND state IN (0, 1)
       ORDER BY is_priority DESC, id LIMIT 1`,
    ).all<{ detail: string }>();
    const stableCallerPlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT id FROM help_requests
       WHERE twitch_user_id = 'stable-viewer' AND state IN (0, 1)
       ORDER BY is_priority DESC, id LIMIT 1`,
    ).all<{ detail: string }>();
    const stableDuplicatePlan = await env.DB.prepare(
      `EXPLAIN QUERY PLAN
       SELECT id FROM help_requests
       WHERE twitch_user_id = 'stable-viewer' AND game_mode = 2 AND map_id = 'customs'
         AND state IN (0, 1)
       ORDER BY is_priority DESC, id LIMIT 1`,
    ).all<{ detail: string }>();

    expect(waitingFifoPlan.results.map((row) => row.detail).join(" ")).toContain(
      "help_requests_waiting_order_idx",
    );
    expect(waitingModePlan.results.map((row) => row.detail).join(" ")).toContain(
      "help_requests_waiting_mode_order_idx",
    );
    expect(callerPlan.results.map((row) => row.detail).join(" ")).toContain(
      "help_requests_one_active_mode_map_per_twitch",
    );
    expect(activeDuplicatePlan.results.map((row) => row.detail).join(" ")).toContain(
      "help_requests_one_active_mode_map_per_twitch",
    );
    expect(stableCallerPlan.results.map((row) => row.detail).join(" ")).toContain(
      "help_requests_one_active_mode_map_per_twitch_id",
    );
    expect(stableDuplicatePlan.results.map((row) => row.detail).join(" ")).toContain(
      "help_requests_one_active_mode_map_per_twitch_id",
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

  it("defaults existing-shape writes to PvE and allows one active request per mode and map", async () => {
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
    await expect(
      env.DB.prepare(
        `INSERT INTO help_requests
           (source_platform, source_delivery_id, twitch_user_id, twitch_login,
            in_game_name, game_mode, map_id, objective, created_at, updated_at)
         VALUES (1, 'pvp', 'twitch-viewer', 'viewer', 'viewer', 1, 'customs', 'Task', ?, ?)`,
      )
        .bind(nowEpoch, nowEpoch)
        .run(),
    ).resolves.toBeDefined();
    expect(
      await env.DB.prepare(
        `SELECT game_mode AS gameMode, typeof(game_mode) AS storageType
         FROM help_requests WHERE source_delivery_id = 'one'`,
      ).first(),
    ).toEqual({ gameMode: 2, storageType: "integer" });
    await env.DB.prepare(
      `INSERT INTO raid_groups
         (is_priority, sort_key, map_id, requester_capacity, created_at, updated_at)
       VALUES (0, 1000000, 'customs', 3, ?, ?)`,
    )
      .bind(nowEpoch, nowEpoch)
      .run();
    expect(
      await env.DB.prepare(
        `SELECT game_mode AS gameMode, typeof(game_mode) AS storageType FROM raid_groups`,
      ).first(),
    ).toEqual({ gameMode: 2, storageType: "integer" });
    await env.DB.prepare(`UPDATE help_requests SET state = 2 WHERE game_mode = 2`).run();
    await expect(insert("three")).resolves.toBeDefined();
  });

  it("rejects memberships with a different mode, map, or queue kind", async () => {
    await insertMapping("compatible", "compatible-id");
    await env.DB.prepare(
      `INSERT INTO help_requests
         (id, source_platform, source_delivery_id, twitch_user_id, twitch_login,
          in_game_name, game_mode, map_id, objective, state, created_at, updated_at)
       VALUES (1, 1, 'compatible', 'compatible-id', 'compatible',
               'PMC', 2, 'customs', 'Task', 1, ?, ?)`,
    )
      .bind(nowEpoch, nowEpoch)
      .run();
    await env.DB.prepare(
      `INSERT INTO raid_groups
         (id, is_priority, game_mode, sort_key, map_id, requester_capacity, created_at, updated_at)
       VALUES (1, 0, 1, 1000000, 'customs', 3, ?, ?),
              (2, 0, 2, 2000000, 'woods', 3, ?, ?),
              (3, 1, 2, 1000000, 'customs', 3, ?, ?),
              (4, 0, 2, 3000000, 'customs', 3, ?, ?)`,
    )
      .bind(nowEpoch, nowEpoch, nowEpoch, nowEpoch, nowEpoch, nowEpoch, nowEpoch, nowEpoch)
      .run();
    const insertMembership = (groupId: number) =>
      env.DB.prepare(
        `INSERT INTO raid_group_members
           (group_id, request_id, position, created_at, updated_at)
         VALUES (?, 1, 1, ?, ?)`,
      )
        .bind(groupId, nowEpoch, nowEpoch)
        .run();
    await expect(insertMembership(1)).rejects.toThrow("raid group membership is incompatible");
    await expect(insertMembership(2)).rejects.toThrow("raid group membership is incompatible");
    await expect(insertMembership(3)).rejects.toThrow("raid group membership is incompatible");
    await expect(insertMembership(4)).resolves.toBeDefined();
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

  it("moves a waiting request to planned atomically and accepts the previous explicit update", async () => {
    await insertMapping("upgrade_viewer", "upgrade-twitch");
    await env.DB.prepare(
      `INSERT INTO help_requests
         (id, source_platform, source_delivery_id, twitch_user_id, twitch_login,
          in_game_name, map_id, objective, state, created_at, updated_at)
       VALUES (1, 1, 'upgrade-request', 'upgrade-twitch', 'upgrade_viewer',
               'PMC', 'customs', 'Task', 0, ?, ?)`,
    )
      .bind(nowEpoch, nowEpoch)
      .run();
    await env.DB.prepare(
      `INSERT INTO raid_groups
         (id, is_priority, sort_key, map_id, requester_capacity, created_at, updated_at)
       VALUES (1, 0, 1000000, 'customs', 3, ?, ?)`,
    )
      .bind(nowEpoch, nowEpoch)
      .run();
    await env.DB.prepare(
      `INSERT INTO raid_group_members
         (group_id, request_id, position, created_at, updated_at)
       VALUES (1, 1, 1, ?, ?)`,
    )
      .bind(nowEpoch, nowEpoch)
      .run();
    await expect(
      env.DB.prepare(`SELECT state FROM help_requests WHERE id = 1`).first(),
    ).resolves.toEqual({ state: 1 });
    const repeated = await env.DB.prepare(
      `UPDATE help_requests SET state = 1, updated_at = ? WHERE id = 1 AND state = 0`,
    )
      .bind(nowEpoch + 1)
      .run();
    expect(repeated.meta.changes).toBe(0);
  });
});
