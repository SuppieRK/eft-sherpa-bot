import { describe, expect, it } from "vitest";
import {
  buildEftNameModal,
  parseUserDirectoryAction,
  renderStaffStatistics,
  renderUserDetail,
  renderUserDirectory,
} from "../../src/infrastructure/discord/staff-insights";

describe("staff insights Discord presentation", () => {
  it("renders a bounded statistics list with mentions disabled", () => {
    const message = renderStaffStatistics({
      submittedRequests: 100_000,
      helpedRequests: 80_000,
      openRequests: 15_000,
      canceledRequests: 5_000,
      successfulRaids: 40_000,
      leaders: Array.from({ length: 10 }, (_, index) => ({
        discordUserId: `${9_000_000_000_000_000_000n + BigInt(index)}`,
        helpedRequests: 10_000 - index,
        successfulRaids: 5_000 - index,
      })),
      omittedLeaderCount: 25,
    });
    expect(message.allowed_mentions).toEqual({ parse: [] });
    expect(message.components).toEqual([]);
    expect(message.embeds).toHaveLength(1);
    expect(JSON.stringify(message)).toContain("25 more leaders");
    expect(JSON.stringify(message).length).toBeLessThan(6_000);
  });

  it("renders a ten-user page without numeric Twitch IDs and parses stateless controls", () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({
      twitchLogin: `viewer_${index}`,
      twitchUserId: `numeric-twitch-${index}`,
      twitchIdentityObserved: true,
      ...(index % 2 === 0
        ? { discordUserId: `${1_000_000_000_000_000_000n + BigInt(index)}` }
        : {}),
      ...(index % 3 === 0 ? { inGameName: `PMC ${index}` } : {}),
    }));
    const message = renderUserDirectory({ entries, hasPrevious: true, hasNext: true });
    const serialized = JSON.stringify(message);
    expect(serialized).not.toContain("numeric-twitch");
    expect(message.allowed_mentions).toEqual({ parse: [] });
    expect(serialized.length).toBeLessThan(6_000);
    expect(parseUserDirectoryAction("users:v1:next:viewer_9")).toEqual({
      action: "next",
      cursor: "viewer_9",
    });
    expect(parseUserDirectoryAction("users:v1:next:BAD-NAME")).toBeUndefined();
  });

  it("shows only missing-detail controls and a bounded EFT modal", () => {
    const detail = renderUserDetail(
      { twitchLogin: "viewer", twitchIdentityObserved: false },
      "page_first",
    );
    expect(JSON.stringify(detail)).toContain("Add Discord member");
    expect(JSON.stringify(detail)).toContain("Add EFT name");
    expect(JSON.stringify(detail)).toContain("`/link-twitch`");
    const modal = buildEftNameModal("viewer", "page_first");
    expect(modal.components[0]?.component).toMatchObject({ min_length: 1, max_length: 64 });
    expect(modal.custom_id.length).toBeLessThanOrEqual(100);
  });
});
