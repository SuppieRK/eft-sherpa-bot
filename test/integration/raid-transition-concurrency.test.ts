import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";
import { D1MvpRepository } from "../../src/infrastructure/cloudflare/d1-mvp-repository";

const at = new Date("2096-08-15T21:00:00Z");

async function create(repo: D1MvpRepository, index: number) {
  return (
    await repo.createRequest({
      sourcePlatform: "twitch",
      sourceDeliveryId: `delivery-${index}`,
      twitchUserId: `identity-${index}`,
      twitchLogin: `viewer_${index}`,
      gameMode: "pve",
      inGameName: "PMC",
      mapId: "customs",
      objective: "Task",
      recipientLimit: 4,
      observedAt: at,
    })
  ).request.id;
}

async function setup() {
  const repo = new D1MvpRepository(env.DB);
  const requestId = await create(repo, 1);
  const source = (await repo.getBoardSnapshot()).ordinaryRaids[0];
  if (!source) throw new Error("Missing fixture raid");
  await repo.reviewRaid({ groupId: source.id, changedAt: at });
  await repo.setRaidStaffMessage(source.id, "review-message", at);
  return { repo, source, requestId };
}

// Interleave at the real database boundary, without mocking repository methods.
function beforeFirstBatch(action: () => Promise<unknown>): D1Database {
  let pending = true;
  return new Proxy(env.DB, {
    get(target, property) {
      if (property === "batch")
        return async (statements: D1PreparedStatement[]) => {
          if (pending) {
            pending = false;
            await action();
          }
          return target.batch(statements);
        };
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}

describe("concurrent staff transitions", () => {
  // This runs 25 complete workflows; CI coverage overhead is not a latency requirement.
  it("keeps follow-ups ordered after more than twenty pull and postpone cycles", async () => {
    const { repo, source } = await setup();
    await repo.createRequest({
      sourcePlatform: "twitch",
      sourceDeliveryId: "woods",
      twitchUserId: "woods",
      twitchLogin: "woods",
      gameMode: "pve",
      inGameName: "PMC",
      mapId: "woods",
      objective: "Task",
      recipientLimit: 4,
      observedAt: at,
    });
    const following = (await repo.getBoardSnapshot()).ordinaryRaids.find(
      (raid) => raid.mapId === "woods",
    );
    if (!following) throw new Error("Missing following raid");
    await repo.createRequest({
      sourcePlatform: "twitch",
      sourceDeliveryId: "factory",
      twitchUserId: "factory",
      twitchLogin: "factory",
      gameMode: "pve",
      inGameName: "PMC",
      mapId: "factory",
      objective: "Task",
      recipientLimit: 4,
      observedAt: at,
    });
    const tail = (await repo.getBoardSnapshot()).ordinaryRaids.find(
      (raid) => raid.mapId === "factory",
    );
    if (!tail) throw new Error("Missing tail raid");
    let previousKey = source.sortKey;
    for (let cycle = 1; cycle <= 25; cycle++) {
      const requestId = await create(repo, cycle + 1);
      const candidates = await repo.getPullRequesterCandidates(source.id);
      if (!candidates) throw new Error("Missing pull candidate");
      await repo.pullRequester({
        destinationGroupId: source.id,
        sourceGroupId: candidates.source.id,
        requestId,
        actionKey: `pull-${cycle}`,
        changedAt: at,
      });
      const moved = await repo.postponeRequester({
        groupId: source.id,
        requestId,
        actionKey: `postpone-${cycle}`,
        changedAt: at,
      });
      expect(moved.dedicated.sortKey).toBeGreaterThan(previousKey);
      expect(moved.dedicated.sortKey).toBeLessThan(
        (await repo.getRaid(following.id))?.sortKey ?? 0,
      );
      previousKey = moved.dedicated.sortKey;
      await repo.reviewRaid({ groupId: moved.dedicated.id, changedAt: at });
      await repo.setRaidStaffMessage(moved.dedicated.id, `follow-up-${cycle}`, at);
      await repo.startRaid({
        groupId: moved.dedicated.id,
        leaderDiscordUserId: "leader",
        leaderType: "streamer",
        requestTwitchCall: false,
        changedAt: at,
      });
      expect((await repo.getRaid(tail.id))?.sortKey).toBe(tail.sortKey);
    }
  }, 30_000);

  it("does not complete requests when whole-raid postponement wins against Helped", async () => {
    const { repo, source, requestId } = await setup();
    await repo.startRaid({
      groupId: source.id,
      leaderDiscordUserId: "leader",
      leaderType: "streamer",
      requestTwitchCall: false,
      changedAt: at,
    });
    const stale = new D1MvpRepository(
      beforeFirstBatch(() =>
        repo.postponeRaid({
          groupId: source.id,
          actionKey: "postpone",
          changedAt: at,
        }),
      ),
    );
    await expect(
      stale.recordRaidResult({
        groupId: source.id,
        outcome: "helped",
        attemptLimit: 3,
        actionKey: "helped",
        changedAt: at,
      }),
    ).rejects.toThrow();
    const current = await repo.getRaid(source.id);
    expect(current?.state).toBe("planned");
    expect(current?.queueKind).toBe("priority");
    expect(current?.members.map((member) => member.requestId)).toEqual([requestId]);
  });

  it("rejects a stale sole-requester postponement after another requester is pulled in", async () => {
    const { repo, source, requestId } = await setup();
    const pulled = await create(repo, 2);
    const donor = (await repo.getBoardSnapshot()).ordinaryRaids.find(
      (raid) => raid.id !== source.id,
    );
    if (!donor) throw new Error("Missing donor raid");
    const stale = new D1MvpRepository(
      beforeFirstBatch(() =>
        repo.pullRequester({
          destinationGroupId: source.id,
          sourceGroupId: donor.id,
          requestId: pulled,
          actionKey: "pull",
          changedAt: at,
        }),
      ),
    );
    await expect(
      stale.postponeRequester({
        groupId: source.id,
        requestId,
        actionKey: "postpone",
        changedAt: at,
      }),
    ).rejects.toThrow();
    const current = await repo.getRaid(source.id);
    expect(current?.state).toBe("planned");
    expect(current?.members.map((member) => member.requestId)).toEqual([requestId, pulled]);
  });

  it("rejects stale removal without canceling a requester moved to another raid", async () => {
    const { repo, source, requestId } = await setup();
    const stale = new D1MvpRepository(
      beforeFirstBatch(() =>
        repo.postponeRequester({
          groupId: source.id,
          requestId,
          actionKey: "postpone",
          changedAt: at,
        }),
      ),
    );
    await expect(
      stale.removeRequester({
        groupId: source.id,
        requestId,
        actionKey: "remove",
        changedAt: at,
      }),
    ).rejects.toThrow("Review the raid again");
    const board = await repo.getBoardSnapshot();
    expect(
      board.ordinaryRaids.flatMap((raid) => raid.members.map((member) => member.requestId)),
    ).toEqual([requestId]);
    const duplicate = await repo.createRequest({
      sourcePlatform: "twitch",
      sourceDeliveryId: "retry",
      twitchUserId: "identity-1",
      twitchLogin: "viewer_1",
      gameMode: "pve",
      inGameName: "PMC",
      mapId: "customs",
      objective: "Task",
      recipientLimit: 4,
      observedAt: at,
    });
    expect(duplicate.request.id).toBe(requestId);
    expect(duplicate.request.state).toBe("planned");
  });
});
