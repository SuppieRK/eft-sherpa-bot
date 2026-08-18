import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { TARKOV_MAPS } from "../../src/domain/maps/catalog";
import type { GameMode } from "../../src/domain/game-mode";
import type { StaffBoardRaid } from "../../src/domain/staff-board";
import { D1Metrics, instrumentD1Database } from "../../src/infrastructure/cloudflare/d1-metrics";
import { D1MvpRepository } from "../../src/infrastructure/cloudflare/d1-mvp-repository";

const now = new Date("2096-08-15T21:00:00.000Z");

function repository(): D1MvpRepository {
  return new D1MvpRepository(env.DB);
}

async function createRequest(
  repo: D1MvpRepository,
  index: number,
  mapId = "customs",
  gameMode: GameMode = "pve",
): Promise<number> {
  const created = await repo.createRequest({
    sourcePlatform: "twitch",
    sourceDeliveryId: `delivery-${index}`,
    twitchUserId: `twitch-${index}`,
    twitchLogin: `viewer_${index}`,
    gameMode,
    inGameName: `PMC ${index}`,
    mapId,
    objective: `Goal ${index}`,
    observedAt: new Date(now.getTime() + index),
  });
  return created.request.id;
}

async function materialize(repo: D1MvpRepository): Promise<void> {
  await repo.materializeWaitingRequests({ recipientLimit: 3, changedAt: now });
}

async function currentMemberCount(groupId: number): Promise<number> {
  const row = await env.DB.prepare(
    `SELECT current_member_count AS count FROM raid_groups WHERE id = ?`,
  )
    .bind(groupId)
    .first<{ count: number }>();
  return Number(row?.count ?? -1);
}

async function start(repo: D1MvpRepository, raid: StaffBoardRaid): Promise<StaffBoardRaid> {
  return repo.startRaid({
    groupId: raid.id,
    leaderDiscordUserId: "leader",
    leaderType: "volunteer",
    requestTwitchCall: false,
    changedAt: now,
  });
}

async function postpone(
  repo: D1MvpRepository,
  raid: StaffBoardRaid,
  suffix: string,
): Promise<void> {
  await start(repo, raid);
  await repo.postponeRaid({ groupId: raid.id, actionKey: suffix, changedAt: now });
}

describe("schedule-independent dual queues", () => {
  it("materializes requests without schedule data and bounds ordinary display at seven", async () => {
    const repo = repository();
    for (let index = 1; index <= 25; index += 1) await createRequest(repo, index);
    await materialize(repo);

    const board = await repo.getBoardSnapshot();
    expect(board).toMatchObject({
      ordinaryRaidCount: 9,
      priorityRaidCount: 0,
    });
    expect(board.ordinaryRaids).toHaveLength(7);
    expect(board.ordinaryRaids.map((raid) => raid.id)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    await expect(
      Promise.all(board.ordinaryRaids.map((raid) => currentMemberCount(raid.id))),
    ).resolves.toEqual(board.ordinaryRaids.map((raid) => raid.members.length));
    expect(board.priorityRaids).toEqual([]);
  });

  it("groups only requests with the same game mode and map", async () => {
    const repo = repository();
    for (let index = 1; index <= 4; index += 1) {
      await createRequest(repo, index, "customs", "pve");
    }
    await createRequest(repo, 5, "customs", "pvp");
    await createRequest(repo, 6, "customs", "pvp-seasonal");
    await materialize(repo);

    const raids = await env.DB.prepare(
      `SELECT raid.game_mode AS gameMode, count(member.id) AS members
       FROM raid_groups AS raid
       JOIN raid_group_members AS member ON member.group_id = raid.id AND member.state = 0
       GROUP BY raid.id ORDER BY raid.sort_key`,
    ).all<{ gameMode: number; members: number }>();
    expect(raids.results).toEqual([
      { gameMode: 2, members: 3 },
      { gameMode: 2, members: 1 },
      { gameMode: 1, members: 1 },
      { gameMode: 0, members: 1 },
    ]);
  });

  it("reserves a visible raid for every non-empty mode under skew", async () => {
    const repo = repository();
    for (let index = 1; index <= 21; index += 1) {
      await createRequest(repo, index, "customs", "pve");
    }
    await createRequest(repo, 22, "customs", "pvp");
    await createRequest(repo, 23, "customs", "pvp-seasonal");
    await materialize(repo);

    const board = await repo.getBoardSnapshot();
    expect(board.ordinaryRaidCount).toBe(9);
    expect(board.ordinaryRaids).toHaveLength(7);
    expect(board.ordinaryRaids.slice(0, 3).map((raid) => raid.gameMode)).toEqual([
      "pve",
      "pvp",
      "pvp-seasonal",
    ]);
    expect(board.ordinaryRaids.filter((raid) => raid.gameMode === "pve")).toHaveLength(5);
  });

  it("reserves a minority-mode raid and keeps dominant-mode FIFO order", async () => {
    const repo = repository();
    for (let index = 1; index <= 21; index += 1) {
      await createRequest(repo, index, "customs", "pve");
    }
    await createRequest(repo, 22, "customs", "pvp");
    await materialize(repo);

    const board = await repo.getBoardSnapshot();
    expect(board.ordinaryRaids.map((raid) => raid.gameMode)).toEqual([
      "pve",
      "pvp",
      "pve",
      "pve",
      "pve",
      "pve",
      "pve",
    ]);
    expect(
      board.ordinaryRaids.filter((raid) => raid.gameMode === "pve").map((raid) => raid.id),
    ).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("applies mode-presence ordering independently to Priority raids", async () => {
    const repo = repository();
    for (let index = 1; index <= 21; index += 1) {
      await createRequest(repo, index, "customs", "pve");
    }
    await createRequest(repo, 22, "customs", "pvp");
    await createRequest(repo, 23, "customs", "pvp-seasonal");
    await materialize(repo);
    const ordinary = (await repo.getBoardSnapshot()).ordinaryRaids;
    for (const [index, mode] of (["pve", "pvp", "pvp-seasonal"] as const).entries()) {
      const raid = ordinary.find((candidate) => candidate.gameMode === mode);
      expect(raid).toBeDefined();
      await postpone(repo, raid as StaffBoardRaid, `priority-mode-${index}`);
    }

    const board = await repo.getBoardSnapshot();
    expect(board.priorityRaidCount).toBe(3);
    expect(board.priorityRaids.map((raid) => raid.gameMode)).toEqual([
      "pve",
      "pvp",
      "pvp-seasonal",
    ]);
    expect(board.ordinaryRaids[0]?.gameMode).toBe("pve");
  });

  it("allows the same viewer to request one map in different modes", async () => {
    const repo = repository();
    const base = {
      sourcePlatform: "twitch" as const,
      twitchUserId: "same-viewer-id",
      twitchLogin: "same_viewer",
      inGameName: "Same PMC",
      mapId: "customs",
      objective: "Task",
      observedAt: now,
    };
    await expect(
      repo.createRequest({ ...base, sourceDeliveryId: "same-pve", gameMode: "pve" }),
    ).resolves.toMatchObject({ outcome: "created" });
    await expect(
      repo.createRequest({ ...base, sourceDeliveryId: "same-pvp", gameMode: "pvp" }),
    ).resolves.toMatchObject({ outcome: "created" });
    await expect(
      repo.createRequest({ ...base, sourceDeliveryId: "same-pve-again", gameMode: "pve" }),
    ).resolves.toMatchObject({ outcome: "already_active" });
  });

  it.each(["active", "reserved"] as const)(
    "appends after an %s raid that cannot accept automatic members",
    async (existingState) => {
      const repo = repository();
      await createRequest(repo, 1);
      await materialize(repo);
      const existing = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
      if (existingState === "active") {
        await start(repo, existing);
      } else {
        await env.DB.prepare(`UPDATE raid_groups SET automatic_fill = 0 WHERE id = ?`)
          .bind(existing.id)
          .run();
      }

      await createRequest(repo, 2);
      await expect(
        repo.materializeWaitingRequests({ recipientLimit: 3, changedAt: now }),
      ).resolves.toBe(1);
      const groups = await env.DB.prepare(
        `SELECT sort_key AS sortKey FROM raid_groups WHERE state IN (0, 1) ORDER BY sort_key`,
      ).all<{ sortKey: number }>();
      expect(groups.results).toEqual([{ sortKey: 1_000_000 }, { sortKey: 2_000_000 }]);
    },
  );

  it("always leaves one map-specific party place for the sherpa", async () => {
    const repo = repository();
    let requestIndex = 1;
    for (const map of TARKOV_MAPS) {
      for (let index = 0; index < map.sherpaPartyCapacity; index += 1) {
        await createRequest(repo, requestIndex, map.id);
        requestIndex += 1;
      }
    }
    await repo.materializeWaitingRequests({ recipientLimit: 99, changedAt: now });

    for (const map of TARKOV_MAPS) {
      const raids = await env.DB.prepare(
        `SELECT id, requester_capacity AS requesterCapacity, current_member_count AS memberCount
         FROM raid_groups WHERE map_id = ? ORDER BY sort_key`,
      )
        .bind(map.id)
        .all<{ id: number; requesterCapacity: number; memberCount: number }>();
      const requesterCapacity = map.sherpaPartyCapacity - 1;
      expect(raids.results).toEqual([
        expect.objectContaining({ requesterCapacity, memberCount: requesterCapacity }),
        expect.objectContaining({ requesterCapacity, memberCount: 1 }),
      ]);

      const [fullRaid, overflowRaid] = raids.results;
      const overflowMember = await env.DB.prepare(
        `SELECT id FROM raid_group_members WHERE group_id = ? AND state = 0`,
      )
        .bind(overflowRaid?.id)
        .first<{ id: number }>();
      await expect(
        env.DB.prepare(
          `UPDATE raid_group_members SET group_id = ?, position = ?
           WHERE id = ? AND state = 0`,
        )
          .bind(fullRaid?.id, map.sherpaPartyCapacity, overflowMember?.id)
          .run(),
      ).rejects.toThrow("raid group capacity exceeded");
      await expect(currentMemberCount(fullRaid?.id as number)).resolves.toBe(requesterCapacity);
      await expect(currentMemberCount(overflowRaid?.id as number)).resolves.toBe(1);
    }
  });

  it("shows independent three-priority and seven-ordinary windows with complete raid totals", async () => {
    const repo = repository();
    for (let index = 1; index <= 12; index += 1) await createRequest(repo, index);
    await materialize(repo);
    const sources = (await repo.getBoardSnapshot()).ordinaryRaids.slice(0, 4);
    for (const [index, raid] of sources.entries()) await postpone(repo, raid, `source-${index}`);
    for (let index = 13; index <= 36; index += 1) await createRequest(repo, index);
    await materialize(repo);

    const board = await repo.getBoardSnapshot();
    expect(board).toMatchObject({
      priorityRaidCount: 4,
      ordinaryRaidCount: 8,
    });
    expect(board.priorityRaids).toHaveLength(3);
    expect(board.ordinaryRaids).toHaveLength(7);
  });

  it("returns the authenticated caller's mode-scoped position", async () => {
    const repo = repository();
    for (let index = 1; index <= 4; index += 1) await createRequest(repo, index);
    await materialize(repo);
    await expect(
      repo.getQueueFacts({ platform: "twitch", userId: "twitch-4" }),
    ).resolves.toMatchObject({
      caller: {
        mapName: "Customs",
        queuePosition: { kind: "exact", ordinal: 4 },
        raidsAhead: { kind: "exact", count: 1 },
      },
    });
  });

  it("does not count another mode in the request ordinal but includes its fair raid head", async () => {
    const repo = repository();
    for (let index = 1; index <= 6; index += 1) {
      await createRequest(repo, index, "customs", "pve");
    }
    await createRequest(repo, 7, "customs", "pvp");
    await materialize(repo);

    await expect(
      repo.getQueueFacts({ platform: "twitch", userId: "twitch-7" }),
    ).resolves.toMatchObject({
      caller: {
        gameMode: "pvp",
        mapName: "Customs",
        queuePosition: { kind: "exact", ordinal: 1 },
        raidsAhead: { kind: "exact", count: 1 },
      },
    });
  });

  it("counts priority raids ahead of an ordinary caller", async () => {
    const repo = repository();
    for (let index = 1; index <= 3; index += 1) await createRequest(repo, index);
    await materialize(repo);
    await postpone(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
      "priority",
    );
    await createRequest(repo, 4);
    await materialize(repo);

    await expect(
      repo.getQueueFacts({ platform: "twitch", userId: "twitch-4" }),
    ).resolves.toMatchObject({
      caller: {
        queuePosition: { kind: "exact", ordinal: 4 },
        raidsAhead: { kind: "exact", count: 1 },
      },
    });
  });

  it("requests a Twitch call for a streamer-led raid without schedule state", async () => {
    const repo = repository();
    await createRequest(repo, 1);
    await materialize(repo);
    const raid = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    const started = await repo.startRaid({
      groupId: raid.id,
      leaderDiscordUserId: "streamer",
      leaderType: "streamer",
      requestTwitchCall: true,
      changedAt: now,
    });
    expect(started).toMatchObject({
      state: "active",
      discordCallStatus: "pending",
      twitchCallStatus: "pending",
    });
  });

  it("starts at any time and advances attempts before completing helped requests", async () => {
    const repo = repository();
    await createRequest(repo, 1);
    await materialize(repo);
    const raid = (await repo.getBoardSnapshot()).ordinaryRaids[0];
    expect(raid).toBeDefined();
    const started = await start(repo, raid as StaffBoardRaid);
    expect(started).toMatchObject({
      state: "active",
      queueKind: "ordinary",
      attemptCount: 1,
      leaderDiscordUserId: "leader",
      discordCallStatus: "pending",
      twitchCallStatus: "not_requested",
    });
    const second = await repo.recordRaidResult({
      groupId: started.id,
      outcome: "unsuccessful",
      attemptLimit: 3,
      actionKey: "attempt-two",
      changedAt: now,
    });
    expect(second.attemptCount).toBe(2);
    const helped = await repo.recordRaidResult({
      groupId: started.id,
      outcome: "helped",
      attemptLimit: 3,
      actionKey: "helped",
      changedAt: now,
    });
    expect(helped).toMatchObject({ state: "completed", outcome: "helped" });
    await expect(currentMemberCount(started.id)).resolves.toBe(0);
  });

  it("does not complete a requester that was postponed out of a helped raid", async () => {
    const repo = repository();
    const firstRequest = await createRequest(repo, 1);
    const postponedRequest = await createRequest(repo, 2);
    await materialize(repo);
    const source = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );
    const moved = await repo.postponeRequester({
      groupId: source.id,
      requestId: postponedRequest,
      actionKey: "move-before-helped",
      changedAt: now,
    });
    await repo.recordRaidResult({
      groupId: source.id,
      outcome: "helped",
      attemptLimit: 3,
      actionKey: "help-source-only",
      changedAt: now,
    });

    const states = await env.DB.prepare(
      `SELECT id, state FROM help_requests WHERE id IN (?, ?) ORDER BY id`,
    )
      .bind(firstRequest, postponedRequest)
      .all<{ id: number; state: number }>();
    expect(states.results).toEqual([
      { id: firstRequest, state: 2 },
      { id: postponedRequest, state: 1 },
    ]);
    expect((await repo.getRaid(moved.dedicated.id))?.members).toHaveLength(1);
    await expect(currentMemberCount(source.id)).resolves.toBe(0);
    await expect(currentMemberCount(moved.dedicated.id)).resolves.toBe(1);
  });

  it("uses Postpone raid as the only unresolved result after the final attempt", async () => {
    const repo = repository();
    for (let index = 1; index <= 3; index += 1) await createRequest(repo, index);
    await materialize(repo);
    const source = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );
    for (const attempt of [2, 3]) {
      await repo.recordRaidResult({
        groupId: source.id,
        outcome: "unsuccessful",
        attemptLimit: 3,
        actionKey: `final-attempt-${attempt}`,
        changedAt: now,
      });
    }
    await expect(
      repo.recordRaidResult({
        groupId: source.id,
        outcome: "unsuccessful",
        attemptLimit: 3,
        actionKey: "extra-unsuccessful",
        changedAt: now,
      }),
    ).rejects.toThrow("Choose Helped or Postpone raid");

    const postponed = await repo.postponeRaid({
      groupId: source.id,
      actionKey: "final-postpone",
      changedAt: now,
    });
    expect(postponed).toMatchObject({
      id: source.id,
      queueKind: "priority",
      state: "planned",
      attemptCount: 0,
      leaderDiscordUserId: "leader",
    });
    expect(postponed.members.map((member) => member.requestId)).toEqual(
      source.members.map((member) => member.requestId),
    );
    const groupCount = await env.DB.prepare(`SELECT count(*) AS count FROM raid_groups`).first<{
      count: number;
    }>();
    expect(groupCount?.count).toBe(1);
  });

  it("postpones a requester into a fillable raid immediately after the source", async () => {
    const repo = repository();
    const firstRequest = await createRequest(repo, 1);
    const secondRequest = await createRequest(repo, 2);
    await materialize(repo);
    const raid = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    await start(repo, raid);
    const result = await repo.postponeRequester({
      groupId: raid.id,
      requestId: secondRequest,
      actionKey: "postpone",
      changedAt: now,
    });
    expect(result.source.members.map((member) => member.requestId)).toEqual([firstRequest]);
    expect(result.dedicated).toMatchObject({
      queueKind: "ordinary",
      automaticFill: true,
      attemptCount: 0,
      leaderDiscordUserId: "leader",
    });
    expect((await repo.getBoardSnapshot()).ordinaryRaids.map((group) => group.id)).toEqual([
      raid.id,
      result.dedicated.id,
    ]);
    await expect(currentMemberCount(raid.id)).resolves.toBe(1);
    await expect(currentMemberCount(result.dedicated.id)).resolves.toBe(1);
  });

  it("fills the only requester's follow-up with a later same-map request", async () => {
    const repo = repository();
    const postponedRequest = await createRequest(repo, 1, "interchange");
    await materialize(repo);
    const source = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );
    const postponed = await repo.postponeRequester({
      groupId: source.id,
      requestId: postponedRequest,
      actionKey: "postpone-only-requester",
      changedAt: now,
    });

    const laterRequest = await createRequest(repo, 2, "interchange");
    await materialize(repo);

    const board = await repo.getBoardSnapshot();
    expect(board.ordinaryRaidCount).toBe(1);
    expect(board.ordinaryRaids[0]).toMatchObject({
      id: postponed.dedicated.id,
      automaticFill: true,
    });
    expect(board.ordinaryRaids[0]?.members.map((member) => member.requestId)).toEqual([
      postponedRequest,
      laterRequest,
    ]);
  });

  it("fills requester follow-ups only with the same game mode", async () => {
    const repo = repository();
    const postponedRequest = await createRequest(repo, 1, "interchange", "pve");
    await materialize(repo);
    const source = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );
    const postponed = await repo.postponeRequester({
      groupId: source.id,
      requestId: postponedRequest,
      actionKey: "postpone-mode-safe",
      changedAt: now,
    });

    const pvpRequest = await createRequest(repo, 2, "interchange", "pvp");
    const pveRequest = await createRequest(repo, 3, "interchange", "pve");
    await materialize(repo);

    const followUp = await repo.getRaid(postponed.dedicated.id);
    expect(followUp?.gameMode).toBe("pve");
    expect(followUp?.members.map((member) => member.requestId)).toEqual([
      postponedRequest,
      pveRequest,
    ]);
    const pvpRaid = (await repo.getBoardSnapshot()).ordinaryRaids.find(
      (raid) => raid.gameMode === "pvp",
    );
    expect(pvpRaid?.members.map((member) => member.requestId)).toEqual([pvpRequest]);
  });

  it("reuses one follow-up for requesters postponed from the same source", async () => {
    const repo = repository();
    const retainedRequest = await createRequest(repo, 1);
    const firstPostponedRequest = await createRequest(repo, 2);
    const secondPostponedRequest = await createRequest(repo, 3);
    await materialize(repo);
    const source = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );

    const first = await repo.postponeRequester({
      groupId: source.id,
      requestId: firstPostponedRequest,
      actionKey: "postpone-first-of-two",
      changedAt: now,
    });
    const second = await repo.postponeRequester({
      groupId: source.id,
      requestId: secondPostponedRequest,
      actionKey: "postpone-second-of-two",
      changedAt: now,
    });

    expect(second.dedicated.id).toBe(first.dedicated.id);
    expect(second.source.members.map((member) => member.requestId)).toEqual([retainedRequest]);
    expect(second.dedicated.members.map((member) => member.requestId)).toEqual([
      firstPostponedRequest,
      secondPostponedRequest,
    ]);
    expect((await repo.getBoardSnapshot()).ordinaryRaidCount).toBe(2);
  });

  it("creates another follow-up after a source-linked follow-up becomes full", async () => {
    const repo = repository();
    const retainedRequest = await createRequest(repo, 1);
    const firstPostponedRequest = await createRequest(repo, 2);
    const secondPostponedRequest = await createRequest(repo, 3);
    await materialize(repo);
    const source = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );
    const first = await repo.postponeRequester({
      groupId: source.id,
      requestId: firstPostponedRequest,
      actionKey: "postpone-before-fill",
      changedAt: now,
    });
    await createRequest(repo, 4);
    await createRequest(repo, 5);
    await materialize(repo);
    expect((await repo.getRaid(first.dedicated.id))?.members).toHaveLength(3);

    const second = await repo.postponeRequester({
      groupId: source.id,
      requestId: secondPostponedRequest,
      actionKey: "postpone-after-fill",
      changedAt: now,
    });

    expect(second.dedicated.id).not.toBe(first.dedicated.id);
    expect(second.source.members.map((member) => member.requestId)).toEqual([retainedRequest]);
    const board = await repo.getBoardSnapshot();
    expect(board.ordinaryRaids.map((raid) => raid.id)).toEqual([
      source.id,
      first.dedicated.id,
      second.dedicated.id,
    ]);
    expect(second.dedicated.members.map((member) => member.requestId)).toEqual([
      secondPostponedRequest,
    ]);
  });

  it.each([
    { mapId: "customs", requesterCapacity: 3 },
    { mapId: "icebreaker", requesterCapacity: 2 },
  ])(
    "keeps a $mapId follow-up within its $requesterCapacity-requester capacity",
    async ({ mapId, requesterCapacity }) => {
      const repo = repository();
      const postponedRequest = await createRequest(repo, 1, mapId);
      await materialize(repo);
      const source = await start(
        repo,
        (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
      );
      const postponed = await repo.postponeRequester({
        groupId: source.id,
        requestId: postponedRequest,
        actionKey: `postpone-${mapId}`,
        changedAt: now,
      });

      for (let index = 2; index <= requesterCapacity + 1; index += 1) {
        await createRequest(repo, index, mapId);
      }
      await materialize(repo);

      const board = await repo.getBoardSnapshot();
      expect(board.ordinaryRaidCount).toBe(2);
      expect(board.ordinaryRaids[0]).toMatchObject({
        id: postponed.dedicated.id,
        requesterCapacity,
      });
      expect(board.ordinaryRaids[0]?.members).toHaveLength(requesterCapacity);
      expect(board.ordinaryRaids[1]?.members).toHaveLength(1);
    },
  );

  it("does not fill a Priority requester follow-up with an Ordinary request", async () => {
    const repo = repository();
    const priorityRequest = await createRequest(repo, 1, "interchange");
    await materialize(repo);
    const ordinarySource = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    await postpone(repo, ordinarySource, "make-priority-source");
    const prioritySource = await start(
      repo,
      (await repo.getBoardSnapshot()).priorityRaids[0] as StaffBoardRaid,
    );
    const postponed = await repo.postponeRequester({
      groupId: prioritySource.id,
      requestId: priorityRequest,
      actionKey: "postpone-priority-requester",
      changedAt: now,
    });

    const ordinaryRequest = await createRequest(repo, 2, "interchange");
    await materialize(repo);

    const board = await repo.getBoardSnapshot();
    expect(board.priorityRaids[0]?.members.map((member) => member.requestId)).toEqual([
      priorityRequest,
    ]);
    expect(board.priorityRaids[0]?.id).toBe(postponed.dedicated.id);
    expect(board.ordinaryRaids[0]?.members.map((member) => member.requestId)).toEqual([
      ordinaryRequest,
    ]);
  });

  it("rolls back every requester-postponement mutation when follow-up creation fails", async () => {
    const repo = repository();
    for (let index = 1; index <= 4; index += 1) await createRequest(repo, index);
    await materialize(repo);
    const raids = (await repo.getBoardSnapshot()).ordinaryRaids;
    const source = await start(repo, raids[0] as StaffBoardRaid);
    await env.DB.prepare(`UPDATE raid_groups SET last_action_key = ? WHERE id = ?`)
      .bind("postpone-failure:postponed", raids[1]?.id)
      .run();
    await expect(
      repo.postponeRequester({
        groupId: source.id,
        requestId: source.members[0]?.requestId as number,
        actionKey: "postpone-failure",
        changedAt: now,
      }),
    ).rejects.toThrow();
    const unchanged = (await repo.getRaid(source.id)) as StaffBoardRaid;
    expect(unchanged.state).toBe("active");
    expect(unchanged.members.map((member) => member.requestId)).toEqual(
      source.members.map((member) => member.requestId),
    );
  });

  it("rolls back the source when a reusable follow-up rejects the membership", async () => {
    const repo = repository();
    const retainedRequest = await createRequest(repo, 1);
    const firstPostponedRequest = await createRequest(repo, 2);
    const secondPostponedRequest = await createRequest(repo, 3);
    await materialize(repo);
    const source = await start(
      repo,
      (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid,
    );
    const first = await repo.postponeRequester({
      groupId: source.id,
      requestId: firstPostponedRequest,
      actionKey: "prepare-reusable-follow-up",
      changedAt: now,
    });
    await env.DB.prepare(
      `CREATE TRIGGER reject_reusable_follow_up
       BEFORE INSERT ON raid_group_members WHEN NEW.group_id = ${first.dedicated.id}
       BEGIN SELECT RAISE(ABORT, 'forced follow-up failure'); END`,
    ).run();

    try {
      await expect(
        repo.postponeRequester({
          groupId: source.id,
          requestId: secondPostponedRequest,
          actionKey: "reject-reusable-follow-up",
          changedAt: now,
        }),
      ).rejects.toThrow("forced follow-up failure");
    } finally {
      await env.DB.prepare(`DROP TRIGGER reject_reusable_follow_up`).run();
    }

    const unchangedSource = (await repo.getRaid(source.id)) as StaffBoardRaid;
    expect(unchangedSource.state).toBe("active");
    expect(unchangedSource.members.map((member) => member.requestId)).toEqual([
      retainedRequest,
      secondPostponedRequest,
    ]);
    expect(
      (await repo.getRaid(first.dedicated.id))?.members.map((member) => member.requestId),
    ).toEqual([firstPostponedRequest]);
  });

  it("closes the empty source when its last requester is postponed", async () => {
    const repo = repository();
    const requestId = await createRequest(repo, 1);
    await materialize(repo);
    const raid = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    await start(repo, raid);
    await repo.setRaidStaffMessage(raid.id, "old-message", now);

    const result = await repo.postponeRequester({
      groupId: raid.id,
      requestId,
      actionKey: "postpone-last",
      changedAt: now,
    });

    expect(result.source).toMatchObject({
      state: "canceled",
      outcome: "not_run",
    });
    expect(result.source.staffMessageId).toBeUndefined();
    expect(result.dedicated).toMatchObject({
      queueKind: "ordinary",
      state: "planned",
      automaticFill: true,
      leaderDiscordUserId: "leader",
    });
    expect((await repo.getBoardSnapshot()).ordinaryRaids.map((group) => group.id)).toEqual([
      result.dedicated.id,
    ]);
    await expect(currentMemberCount(raid.id)).resolves.toBe(0);
    await expect(currentMemberCount(result.dedicated.id)).resolves.toBe(1);
  });

  it("removes requests permanently and closes a source after its last requester", async () => {
    const repo = repository();
    const firstRequest = await createRequest(repo, 1);
    const secondRequest = await createRequest(repo, 2);
    await materialize(repo);
    const raid = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    await start(repo, raid);
    await repo.setRaidStaffMessage(raid.id, "remove-message", now);

    const remaining = await repo.removeRequester({
      groupId: raid.id,
      requestId: secondRequest,
      actionKey: "remove-second",
      changedAt: now,
    });
    expect(remaining).toMatchObject({ state: "active" });
    expect(remaining.members.map((member) => member.requestId)).toEqual([firstRequest]);
    await expect(currentMemberCount(raid.id)).resolves.toBe(1);

    const closed = await repo.removeRequester({
      groupId: raid.id,
      requestId: firstRequest,
      actionKey: "remove-first",
      changedAt: now,
    });
    expect(closed).toMatchObject({ state: "canceled", outcome: "not_run" });
    expect(closed.staffMessageId).toBeUndefined();
    await expect(currentMemberCount(raid.id)).resolves.toBe(0);
    await materialize(repo);
    expect((await repo.getBoardSnapshot()).ordinaryRaids).toEqual([]);
    const requests = await env.DB.prepare(
      `SELECT id, CASE state WHEN 3 THEN 'canceled' ELSE 'other' END AS state
       FROM help_requests ORDER BY id`,
    ).all<{ id: number; state: string }>();
    expect(requests.results).toEqual([
      { id: firstRequest, state: "canceled" },
      { id: secondRequest, state: "canceled" },
    ]);
  });

  it("moves the same whole raid to the end of priority with attempts reset", async () => {
    const repo = repository();
    for (let index = 1; index <= 4; index += 1) await createRequest(repo, index);
    await materialize(repo);
    const ordinary = (await repo.getBoardSnapshot()).ordinaryRaids;
    await postpone(repo, ordinary[0] as StaffBoardRaid, "existing-priority");
    const source = ordinary[1] as StaffBoardRaid;
    const started = await start(repo, source);
    await repo.updateCallStatus(started.id, "discord", "sent", now);
    await repo.setRaidStaffMessage(started.id, "postpone-message", now);

    const postponed = await repo.postponeRaid({
      groupId: started.id,
      actionKey: "postpone-whole-raid",
      changedAt: now,
    });
    expect(postponed).toMatchObject({
      id: started.id,
      queueKind: "priority",
      state: "planned",
      attemptCount: 0,
      automaticFill: false,
      leaderDiscordUserId: "leader",
      discordCallStatus: "not_requested",
      twitchCallStatus: "not_requested",
    });
    expect(postponed.staffMessageId).toBeUndefined();
    expect(postponed.members.map((member) => member.requestId)).toEqual(
      started.members.map((member) => member.requestId),
    );
    const requests = await env.DB.prepare(
      `SELECT CASE is_priority WHEN 1 THEN 'priority' ELSE 'ordinary' END AS queueKind,
              CASE state WHEN 1 THEN 'planned' ELSE 'other' END AS state
       FROM help_requests
       WHERE id IN (${started.members.map(() => "?").join(",")}) ORDER BY id`,
    )
      .bind(...started.members.map((member) => member.requestId))
      .all<{ queueKind: string; state: string }>();
    expect(requests.results).toEqual(
      started.members.map(() => ({ queueKind: "priority", state: "planned" })),
    );

    await start(repo, postponed);
    const postponedAgain = await repo.postponeRaid({
      groupId: postponed.id,
      actionKey: "postpone-priority-again",
      changedAt: now,
    });
    expect(postponedAgain).toMatchObject({
      id: postponed.id,
      queueKind: "priority",
      state: "planned",
      attemptCount: 0,
      leaderDiscordUserId: "leader",
    });
  });

  it("does not mutate outstanding raids when time advances", async () => {
    const repo = repository();
    await createRequest(repo, 1);
    await materialize(repo);
    const before = (await repo.getBoardSnapshot()).ordinaryRaids[0] as StaffBoardRaid;
    await repo.materializeWaitingRequests({
      changedAt: new Date("2196-08-16T04:00:00.000Z"),
      recipientLimit: 3,
    });
    const after = (await repo.getBoardSnapshot()).ordinaryRaids[0];
    expect(after).toMatchObject({
      id: before.id,
      queueKind: before.queueKind,
      state: before.state,
      attemptCount: before.attemptCount,
    });
  });

  it("checks only for waiting requests in the steady-state materialization path", async () => {
    const repo = repository();
    await createRequest(repo, 1);
    await materialize(repo);
    const metrics = new D1Metrics();
    const measured = new D1MvpRepository(instrumentD1Database(env.DB, metrics));
    await expect(
      measured.materializeWaitingRequests({ recipientLimit: 3, changedAt: now }),
    ).resolves.toBe(0);
    expect(metrics.snapshot().statements).toBe(1);
  });

  it("materializes a backlog in one bulk assignment and keeps every requester", async () => {
    const repo = repository();
    for (let index = 1; index <= 180; index += 1) await createRequest(repo, index);
    const metrics = new D1Metrics();
    const measured = new D1MvpRepository(instrumentD1Database(env.DB, metrics));
    await expect(
      measured.materializeWaitingRequests({ recipientLimit: 3, changedAt: now }),
    ).resolves.toBe(180);
    expect(metrics.snapshot().statements).toBe(6);
    const stored = await env.DB.prepare(
      `SELECT count(*) AS requestCount,
              (SELECT count(*) FROM raid_groups WHERE state = 0) AS raidCount,
              (SELECT count(*) FROM raid_group_members WHERE state = 0) AS memberCount
         FROM help_requests WHERE state = 1`,
    ).first<{ requestCount: number; raidCount: number; memberCount: number }>();
    expect(stored).toEqual({ requestCount: 180, raidCount: 60, memberCount: 180 });

    const queueMetrics = new D1Metrics();
    const queueRepository = new D1MvpRepository(instrumentD1Database(env.DB, queueMetrics));
    await expect(
      queueRepository.getQueueFacts({ platform: "twitch", userId: "twitch-180" }),
    ).resolves.toMatchObject({
      caller: {
        queuePosition: { kind: "more_than", requestsAhead: 100 },
        raidsAhead: { kind: "more_than", count: 50 },
      },
    });
    expect(queueMetrics.snapshot().statements).toBe(8);
    expect(queueMetrics.snapshot().rowsRead).toBeLessThan(200);
  }, 15_000);

  it("expires old delivery receipts while preserving recent duplicate protection", async () => {
    const repo = repository();
    const old = new Date(now.getTime() - 25 * 60 * 60 * 1_000);
    await repo.claimDiscordMutation("old", "component", old);
    await expect(repo.claimDiscordMutation("recent", "component", now)).resolves.toBe(true);
    await expect(repo.claimDiscordMutation("recent", "component", now)).resolves.toBe(false);
    const receipts = await env.DB.prepare(
      `SELECT delivery_id AS deliveryId FROM event_receipts ORDER BY delivery_id`,
    ).all<{ deliveryId: string }>();
    expect(receipts.results).toEqual([{ deliveryId: "recent" }]);
  });
});
