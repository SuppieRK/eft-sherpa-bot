import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { D1Metrics, instrumentD1Database } from "../../src/infrastructure/cloudflare/d1-metrics";
import { D1MvpRepository } from "../../src/infrastructure/cloudflare/d1-mvp-repository";

const now = new Date("2096-08-20T12:00:00.000Z");

async function authoritativeStatistics() {
  const summary = await env.DB.prepare(
    `SELECT count(*) AS submittedRequests,
            coalesce(sum(state = 2), 0) AS helpedRequests,
            coalesce(sum(state IN (0, 1)), 0) AS openRequests,
            coalesce(sum(state = 3), 0) AS canceledRequests,
            (SELECT count(*) FROM raid_groups WHERE state = 2 AND outcome = 0)
              AS successfulRaids
     FROM help_requests`,
  ).first<{
    submittedRequests: number;
    helpedRequests: number;
    openRequests: number;
    canceledRequests: number;
    successfulRaids: number;
  }>();
  const leaders = await env.DB.prepare(
    `SELECT raid.leader_discord_user_id AS discordUserId,
            count(member.id) AS helpedRequests,
            count(DISTINCT raid.id) AS successfulRaids
     FROM raid_groups AS raid
     JOIN raid_group_members AS member ON member.group_id = raid.id AND member.state = 1
     WHERE raid.state = 2 AND raid.outcome = 0
       AND raid.leader_discord_user_id IS NOT NULL
     GROUP BY raid.leader_discord_user_id
     ORDER BY helpedRequests DESC, successfulRaids DESC, discordUserId ASC`,
  ).all<{ discordUserId: string; helpedRequests: number; successfulRaids: number }>();
  return {
    submittedRequests: Number(summary?.submittedRequests ?? 0),
    helpedRequests: Number(summary?.helpedRequests ?? 0),
    openRequests: Number(summary?.openRequests ?? 0),
    canceledRequests: Number(summary?.canceledRequests ?? 0),
    successfulRaids: Number(summary?.successfulRaids ?? 0),
    leaders: leaders.results.slice(0, 10).map((leader) => ({
      discordUserId: leader.discordUserId,
      helpedRequests: Number(leader.helpedRequests),
      successfulRaids: Number(leader.successfulRaids),
    })),
    omittedLeaderCount: Math.max(0, leaders.results.length - 10),
  };
}

async function insertUser(
  index: number,
  input: { twitchId?: string; discordId?: string; inGameName?: string } = {},
): Promise<string> {
  const login = `viewer_${String(index).padStart(3, "0")}`;
  await env.DB.prepare(
    `INSERT INTO user_mappings
     (twitch_login, twitch_user_id, discord_user_id, discord_display_name,
      in_game_name, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      login,
      input.twitchId ?? null,
      input.discordId ?? null,
      input.discordId === undefined ? null : `Discord ${index}`,
      input.inGameName ?? null,
      now.getTime(),
      now.getTime(),
    )
    .run();
  return login;
}

async function insertRequest(index: number, state: 0 | 1 | 2 | 3): Promise<number> {
  const login = await insertUser(index, { twitchId: `twitch-${index}` });
  const row = await env.DB.prepare(
    `INSERT INTO help_requests
     (source_platform, source_delivery_id, twitch_user_id, twitch_login, in_game_name,
      game_mode, map_id, objective, state, created_at, updated_at)
     VALUES (1, ?, ?, ?, ?, 2, 'customs', ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      `delivery-${index}`,
      `twitch-${index}`,
      login,
      `PMC ${index}`,
      `Goal ${index}`,
      state,
      now.getTime(),
      now.getTime(),
    )
    .first<{ id: number }>();
  return Number(row?.id);
}

async function insertTerminalRaid(input: {
  index: number;
  leaderDiscordUserId?: string;
  outcome: 0 | 1;
  members: Array<{ requestId: number; state: 1 | 2 }>;
}): Promise<number> {
  const raid = await env.DB.prepare(
    `INSERT INTO raid_groups
     (is_priority, sort_key, game_mode, map_id, requester_capacity,
      leader_discord_user_id, leader_type, state, outcome, completed_at, created_at, updated_at)
     VALUES (0, ?, 2, 'customs', 4, ?, ?, 2, ?, ?, ?, ?) RETURNING id`,
  )
    .bind(
      input.index * 1_000_000,
      input.leaderDiscordUserId ?? null,
      input.leaderDiscordUserId === undefined ? null : 1,
      input.outcome,
      now.getTime(),
      now.getTime(),
      now.getTime(),
    )
    .first<{ id: number }>();
  const groupId = Number(raid?.id);
  if (input.members.length > 0) {
    await env.DB.batch(
      input.members.map((member, position) =>
        env.DB.prepare(
          `INSERT INTO raid_group_members
           (group_id, request_id, position, state, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(groupId, member.requestId, position + 1, member.state, now.getTime(), now.getTime()),
      ),
    );
  }
  return groupId;
}

describe("staff statistics repository", () => {
  it("returns an empty read-only all-time snapshot", async () => {
    const metrics = new D1Metrics();
    const repository = new D1MvpRepository(instrumentD1Database(env.DB, metrics));

    await expect(repository.getStaffStatistics()).resolves.toEqual({
      submittedRequests: 0,
      helpedRequests: 0,
      openRequests: 0,
      canceledRequests: 0,
      successfulRaids: 0,
      leaders: [],
      omittedLeaderCount: 0,
    });
    expect(metrics.snapshot()).toMatchObject({ statements: 2, rowsWritten: 0 });
  });

  it("counts every state and credits only completed members in helped raids", async () => {
    const completed = await insertRequest(1, 2);
    const waiting = await insertRequest(2, 0);
    await insertRequest(3, 1);
    await insertRequest(4, 3);
    const postponedThenCompleted = await insertRequest(5, 2);
    await insertTerminalRaid({
      index: 1,
      leaderDiscordUserId: "leader-a",
      outcome: 0,
      members: [
        { requestId: completed, state: 1 },
        { requestId: postponedThenCompleted, state: 1 },
      ],
    });
    await insertTerminalRaid({
      index: 2,
      leaderDiscordUserId: "leader-a",
      outcome: 0,
      members: [{ requestId: waiting, state: 2 }],
    });
    await insertTerminalRaid({
      index: 3,
      leaderDiscordUserId: "leader-b",
      outcome: 1,
      members: [{ requestId: waiting, state: 1 }],
    });
    await insertTerminalRaid({ index: 4, outcome: 0, members: [] });

    await expect(new D1MvpRepository(env.DB).getStaffStatistics()).resolves.toEqual({
      submittedRequests: 5,
      helpedRequests: 2,
      openRequests: 2,
      canceledRequests: 1,
      successfulRaids: 3,
      leaders: [{ discordUserId: "leader-a", helpedRequests: 2, successfulRaids: 1 }],
      omittedLeaderCount: 0,
    });
  });

  it("ranks deterministically and reports leaders beyond the first ten", async () => {
    for (let index = 1; index <= 12; index += 1) {
      const requestId = await insertRequest(index, 2);
      await insertTerminalRaid({
        index,
        leaderDiscordUserId: `leader-${String(index).padStart(2, "0")}`,
        outcome: 0,
        members: [{ requestId, state: 1 }],
      });
    }

    const statistics = await new D1MvpRepository(env.DB).getStaffStatistics();
    expect(statistics.leaders.map((leader) => leader.discordUserId)).toEqual(
      Array.from({ length: 10 }, (_, index) => `leader-${String(index + 1).padStart(2, "0")}`),
    );
    expect(statistics.leaders.every((leader) => leader.helpedRequests === 1)).toBe(true);
    expect(statistics.omittedLeaderCount).toBe(2);
  });

  it("keeps rollups equal to source data across terminal corrections and deletions", async () => {
    const repository = new D1MvpRepository(env.DB);
    const first = await insertRequest(1, 2);
    const second = await insertRequest(2, 2);
    const third = await insertRequest(3, 3);
    const groupId = await insertTerminalRaid({
      index: 1,
      leaderDiscordUserId: "leader-a",
      outcome: 0,
      members: [
        { requestId: first, state: 1 },
        { requestId: second, state: 1 },
        { requestId: third, state: 2 },
      ],
    });
    await expect(repository.getStaffStatistics()).resolves.toEqual(await authoritativeStatistics());

    await env.DB.prepare(`UPDATE raid_groups SET leader_discord_user_id = 'leader-b' WHERE id = ?`)
      .bind(groupId)
      .run();
    await expect(repository.getStaffStatistics()).resolves.toEqual(await authoritativeStatistics());

    await env.DB.prepare(
      `UPDATE raid_group_members SET state = 2 WHERE group_id = ? AND request_id = ?`,
    )
      .bind(groupId, first)
      .run();
    await expect(repository.getStaffStatistics()).resolves.toEqual(await authoritativeStatistics());

    await env.DB.prepare(`DELETE FROM raid_group_members WHERE group_id = ? AND request_id = ?`)
      .bind(groupId, second)
      .run();
    await expect(repository.getStaffStatistics()).resolves.toEqual(await authoritativeStatistics());

    const fourth = await insertRequest(4, 2);
    const plannedRaid = await env.DB.prepare(
      `INSERT INTO raid_groups
       (is_priority, sort_key, game_mode, map_id, requester_capacity,
        leader_discord_user_id, leader_type, state, created_at, updated_at)
       VALUES (0, 2000000, 2, 'customs', 4, 'leader-c', 1, 0, ?, ?)
       RETURNING id`,
    )
      .bind(now.getTime(), now.getTime())
      .first<{ id: number }>();
    const plannedRaidId = Number(plannedRaid?.id);
    await env.DB.prepare(
      `INSERT INTO raid_group_members
       (group_id, request_id, position, state, created_at, updated_at)
       VALUES (?, ?, 1, 0, ?, ?)`,
    )
      .bind(plannedRaidId, fourth, now.getTime(), now.getTime())
      .run();
    await env.DB.prepare(
      `UPDATE raid_group_members SET state = 1 WHERE group_id = ? AND request_id = ?`,
    )
      .bind(plannedRaidId, fourth)
      .run();
    await env.DB.prepare(
      `UPDATE raid_groups
       SET state = 2, outcome = 0, completed_at = ?, updated_at = ?
       WHERE id = ?`,
    )
      .bind(now.getTime(), now.getTime(), plannedRaidId)
      .run();
    await expect(repository.getStaffStatistics()).resolves.toEqual(await authoritativeStatistics());

    await env.DB.prepare(`UPDATE raid_groups SET outcome = 1 WHERE id = ?`)
      .bind(plannedRaidId)
      .run();
    await expect(repository.getStaffStatistics()).resolves.toEqual(await authoritativeStatistics());
    await env.DB.prepare(`UPDATE raid_groups SET outcome = 0 WHERE id = ?`)
      .bind(plannedRaidId)
      .run();
    await expect(repository.getStaffStatistics()).resolves.toEqual(await authoritativeStatistics());

    const fifth = await insertRequest(5, 2);
    const transferSourceId = await insertTerminalRaid({
      index: 3,
      leaderDiscordUserId: "leader-d",
      outcome: 0,
      members: [{ requestId: fifth, state: 1 }],
    });
    await env.DB.prepare(
      `UPDATE raid_group_members SET group_id = ?, position = 2
       WHERE group_id = ? AND request_id = ?`,
    )
      .bind(plannedRaidId, transferSourceId, fifth)
      .run();
    await expect(repository.getStaffStatistics()).resolves.toEqual(await authoritativeStatistics());

    await env.DB.prepare(`DELETE FROM raid_groups WHERE id = ?`).bind(groupId).run();
    await expect(repository.getStaffStatistics()).resolves.toEqual(await authoritativeStatistics());

    await env.DB.prepare(`UPDATE help_requests SET state = 3 WHERE id = ?`).bind(first).run();
    await env.DB.prepare(`DELETE FROM help_requests WHERE id = ?`).bind(second).run();
    await expect(repository.getStaffStatistics()).resolves.toEqual(await authoritativeStatistics());
  });
});

describe("staff user directory repository", () => {
  it("returns correct empty, one-page, and exact-page boundaries", async () => {
    const repository = new D1MvpRepository(env.DB);
    await expect(repository.getUserDirectoryPage({ direction: "first" })).resolves.toEqual({
      entries: [],
      hasPrevious: false,
      hasNext: false,
    });
    await insertUser(1);
    await insertUser(2);
    await expect(repository.getUserDirectoryPage({ direction: "first" })).resolves.toMatchObject({
      hasPrevious: false,
      hasNext: false,
    });
    await expect(
      repository.getUserDirectoryPage({ direction: "at", cursor: "viewer_001" }),
    ).resolves.toMatchObject({ hasPrevious: false });
    await expect(
      repository.getUserDirectoryPage({ direction: "at", cursor: "viewer_002" }),
    ).resolves.toMatchObject({ hasPrevious: true });
  });

  it("uses stable forward and reverse keyset pages without writes", async () => {
    for (let index = 1; index <= 25; index += 1) {
      await insertUser(index, {
        ...(index % 2 === 0 ? { twitchId: `twitch-${index}` } : {}),
        ...(index % 3 === 0 ? { discordId: `discord-${index}` } : {}),
        ...(index % 5 === 0 ? { inGameName: `PMC ${index}` } : {}),
      });
    }
    const metrics = new D1Metrics();
    const repository = new D1MvpRepository(instrumentD1Database(env.DB, metrics));
    const first = await repository.getUserDirectoryPage({ direction: "first" });
    const middle = await repository.getUserDirectoryPage({
      direction: "next",
      cursor: first.entries.at(-1)?.twitchLogin as string,
    });
    const last = await repository.getUserDirectoryPage({
      direction: "next",
      cursor: middle.entries.at(-1)?.twitchLogin as string,
    });
    const middleAgain = await repository.getUserDirectoryPage({
      direction: "previous",
      cursor: last.entries[0]?.twitchLogin as string,
    });

    expect(first.entries.map((entry) => entry.twitchLogin)).toEqual(
      Array.from({ length: 10 }, (_, index) => `viewer_${String(index + 1).padStart(3, "0")}`),
    );
    expect(middleAgain.entries).toEqual(middle.entries);
    expect(last).toMatchObject({ hasPrevious: true, hasNext: false });
    expect(metrics.snapshot()).toMatchObject({ statements: 4, rowsWritten: 0 });
  });

  it("fills only absent details and preserves unique Discord associations", async () => {
    await insertUser(1);
    await insertUser(2, { discordId: "discord-used", inGameName: "Existing PMC" });
    await insertUser(3);
    const repository = new D1MvpRepository(env.DB);

    await expect(
      repository.completeMissingDiscord({
        twitchLogin: "viewer_001",
        discordUserId: "discord-new",
        discordDisplayName: "New member",
        changedAt: now,
      }),
    ).resolves.toBe("updated");
    await expect(
      repository.completeMissingDiscord({
        twitchLogin: "viewer_001",
        discordUserId: "different",
        changedAt: now,
      }),
    ).resolves.toBe("stale");
    await expect(
      repository.completeMissingInGameName({
        twitchLogin: "viewer_001",
        inGameName: "New PMC",
        changedAt: now,
      }),
    ).resolves.toBe("updated");
    await expect(
      repository.completeMissingInGameName({
        twitchLogin: "viewer_001",
        inGameName: "Replacement",
        changedAt: now,
      }),
    ).resolves.toBe("stale");
    await expect(
      repository.completeMissingDiscord({
        twitchLogin: "viewer_003",
        discordUserId: "discord-used",
        changedAt: now,
      }),
    ).rejects.toThrow();
    await expect(repository.findUserMappingByTwitchLogin("viewer_001")).resolves.toMatchObject({
      discordUserId: "discord-new",
      inGameName: "New PMC",
    });
  });

  it("allows only one concurrent missing-field completion to win", async () => {
    await insertUser(1);
    const repository = new D1MvpRepository(env.DB);
    const outcomes = await Promise.all([
      repository.completeMissingInGameName({
        twitchLogin: "viewer_001",
        inGameName: "First PMC",
        changedAt: now,
      }),
      repository.completeMissingInGameName({
        twitchLogin: "viewer_001",
        inGameName: "Second PMC",
        changedAt: now,
      }),
    ]);
    expect(outcomes.sort()).toEqual(["stale", "updated"]);
  });
});
