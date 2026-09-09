import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { D1MvpRepository } from "../../src/infrastructure/cloudflare/d1-mvp-repository";

const originalTime = new Date("2096-08-15T21:00:00Z");
const observedAt = new Date(originalTime.getTime() + 1_000);
const paths = ["observation", "request"] as const;

async function seedIdentity(targetDetails: boolean) {
  const repository = new D1MvpRepository(env.DB);
  await repository.upsertUserMapping({
    twitchLogin: "old_name",
    twitchUserId: "stable-viewer",
    discordUserId: "old-discord",
    discordDisplayName: "Old Discord",
    inGameName: "Old PMC",
    observedAt: originalTime,
  });
  const oldRequest = await repository.createRequest({
    sourcePlatform: "twitch",
    sourceDeliveryId: "old-request",
    twitchLogin: "old_name",
    twitchUserId: "stable-viewer",
    inGameName: "Old PMC",
    gameMode: "pve",
    mapId: "customs",
    objective: "Existing task",
    recipientLimit: 4,
    observedAt: originalTime,
  });
  await env.DB.prepare(`INSERT INTO user_mappings
    (twitch_login, discord_user_id, discord_display_name, in_game_name, created_at, updated_at)
    VALUES ('new_name', ?, ?, ?, ?, ?)`)
    .bind(
      targetDetails ? "new-discord" : null,
      targetDetails ? "New Discord" : null,
      targetDetails ? "New PMC" : null,
      originalTime.getTime(),
      originalTime.getTime(),
    )
    .run();
  return { repository, oldRequest };
}

function observe(
  repository: D1MvpRepository,
  path: (typeof paths)[number],
  time = observedAt,
  twitchLogin = "new_name",
) {
  if (path === "observation") {
    return repository.observeTwitchIdentity({
      twitchLogin,
      twitchUserId: "stable-viewer",
      observedAt: time,
    });
  }
  return repository.createRequest({
    sourcePlatform: "twitch",
    sourceDeliveryId: "renamed-request",
    twitchLogin,
    twitchUserId: "stable-viewer",
    inGameName: twitchLogin,
    gameMode: "pve",
    mapId: "woods",
    objective: "New task",
    recipientLimit: 4,
    observedAt: time,
  });
}

it.each(paths)("merges missing details and existing request links through %s", async (path) => {
  const { repository, oldRequest } = await seedIdentity(false);
  await observe(repository, path);
  await expect(repository.findUserMappingByTwitchLogin("new_name")).resolves.toMatchObject({
    twitchUserId: "stable-viewer",
    discordUserId: "old-discord",
    discordDisplayName: "Old Discord",
    inGameName: "Old PMC",
  });
  await expect(repository.findUserMappingByTwitchLogin("old_name")).resolves.toBeUndefined();
  await expect(
    env.DB.prepare("SELECT twitch_login FROM help_requests WHERE id = ?")
      .bind(oldRequest.request.id)
      .first(),
  ).resolves.toEqual({ twitch_login: "new_name" });
  await expect(
    repository.getQueueFacts({ platform: "discord", userId: "old-discord" }),
  ).resolves.toHaveProperty("caller");
});

it.each(paths)("retains target details instead of old details through %s", async (path) => {
  const { repository } = await seedIdentity(true);
  await observe(repository, path);
  await expect(repository.findUserMappingByTwitchLogin("new_name")).resolves.toMatchObject({
    twitchUserId: "stable-viewer",
    discordUserId: "new-discord",
    discordDisplayName: "New Discord",
    inGameName: "New PMC",
  });
  await expect(repository.findUserMappingByTwitchLogin("old_name")).resolves.toBeUndefined();
});

it.each(paths)("fills each missing target field independently through %s", async (path) => {
  const { repository } = await seedIdentity(false);
  await env.DB.prepare(
    "UPDATE user_mappings SET in_game_name = 'Target PMC' WHERE twitch_login = 'new_name'",
  ).run();
  await observe(repository, path);
  await expect(repository.findUserMappingByTwitchLogin("new_name")).resolves.toMatchObject({
    discordUserId: "old-discord",
    discordDisplayName: "Old Discord",
    inGameName: "Target PMC",
  });
});

it.each(paths)(
  "rejects a different verified target without changing identities through %s",
  async (path) => {
    const { repository } = await seedIdentity(true);
    await env.DB.prepare(
      "UPDATE user_mappings SET twitch_user_id = 'other-viewer' WHERE twitch_login = 'new_name'",
    ).run();
    const before = await env.DB.prepare("SELECT * FROM user_mappings ORDER BY twitch_login").all();
    await expect(observe(repository, path)).rejects.toThrow("another verified Twitch identity");
    expect(
      (await env.DB.prepare("SELECT * FROM user_mappings ORDER BY twitch_login").all()).results,
    ).toEqual(before.results);
  },
);

it.each(paths)("retains the newest identity after a delayed delivery through %s", async (path) => {
  const { repository } = await seedIdentity(false);
  await observe(repository, "observation");
  await observe(repository, path, originalTime, "old_name");
  await expect(repository.findUserMappingByTwitchLogin("new_name")).resolves.toMatchObject({
    twitchUserId: "stable-viewer",
    discordUserId: "old-discord",
    inGameName: "Old PMC",
  });
  await expect(repository.findUserMappingByTwitchLogin("old_name")).resolves.toBeUndefined();
});

it("merges identity without duplicating an already active mode and map", async () => {
  const { repository, oldRequest } = await seedIdentity(false);
  const result = await repository.createRequest({
    sourcePlatform: "twitch",
    sourceDeliveryId: "same-task-after-rename",
    twitchLogin: "new_name",
    twitchUserId: "stable-viewer",
    inGameName: "new_name",
    gameMode: "pve",
    mapId: "customs",
    objective: "Existing task",
    recipientLimit: 4,
    observedAt,
  });
  expect(result.outcome).toBe("already_active");
  expect(result.request.id).toBe(oldRequest.request.id);
  await expect(repository.findUserMappingByTwitchLogin("old_name")).resolves.toBeUndefined();
  await expect(repository.findUserMappingByTwitchLogin("new_name")).resolves.toMatchObject({
    twitchUserId: "stable-viewer",
    discordUserId: "old-discord",
    inGameName: "Old PMC",
  });
  await expect(
    env.DB.prepare("SELECT count(*) AS count FROM raid_group_members WHERE state = 0").first(),
  ).resolves.toEqual({ count: 1 });
});

it("rolls back the identity merge when request assignment fails", async () => {
  const { repository } = await seedIdentity(false);
  const before = await env.DB.prepare("SELECT * FROM user_mappings ORDER BY twitch_login").all();
  await env.DB.prepare(`CREATE TRIGGER test_identity_assignment_failure BEFORE INSERT ON raid_group_members
    BEGIN SELECT RAISE(ABORT, 'test assignment failure'); END`).run();
  try {
    await expect(observe(repository, "request")).rejects.toThrow("test assignment failure");
    expect(
      (await env.DB.prepare("SELECT * FROM user_mappings ORDER BY twitch_login").all()).results,
    ).toEqual(before.results);
    await expect(
      env.DB.prepare("SELECT count(*) AS count FROM help_requests").first(),
    ).resolves.toEqual({ count: 1 });
  } finally {
    await env.DB.prepare("DROP TRIGGER test_identity_assignment_failure").run();
  }
});
