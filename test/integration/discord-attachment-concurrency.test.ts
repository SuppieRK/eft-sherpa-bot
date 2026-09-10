import { env } from "cloudflare:workers";
import { expect, it } from "vitest";
import { D1MvpRepository } from "../../src/infrastructure/cloudflare/d1-mvp-repository";

it("allows only one competing public attachment and preserves the losing caller's old link", async () => {
  const repo = new D1MvpRepository(env.DB);
  const at = new Date();
  await repo.linkDiscordToTwitch({
    twitchLogin: "first",
    discordUserId: "first-discord",
    linkedAt: at,
  });
  await repo.linkDiscordToTwitch({
    twitchLogin: "second",
    discordUserId: "second-discord",
    linkedAt: at,
  });
  await repo.observeTwitchIdentity({
    twitchLogin: "target",
    twitchUserId: "target-id",
    observedAt: at,
  });
  const results = await Promise.allSettled(
    ["first", "second"].map((caller) =>
      new D1MvpRepository(env.DB).linkDiscordToTwitch({
        twitchLogin: "target",
        discordUserId: `${caller}-discord`,
        linkedAt: at,
      }),
    ),
  );
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  const winner = (await repo.findUserMappingByTwitchLogin("target"))?.discordUserId;
  const loser = winner === "first-discord" ? "second" : "first";
  expect(await repo.findUserMappingByDiscordId(`${loser}-discord`)).toMatchObject({
    twitchLogin: loser,
  });
});
