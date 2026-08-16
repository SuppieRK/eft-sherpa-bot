import { describe, expect, it } from "vitest";
import {
  communityConfigFromEnvironment,
  requireCommunityConfig,
  validateCommunityConfig,
} from "../../src/config/community";
import { testCommunityConfig } from "../fixtures/community";

describe("fixed MVP community configuration", () => {
  it("accepts a complete single-community configuration", () => {
    expect(validateCommunityConfig(testCommunityConfig)).toEqual([]);
    expect(requireCommunityConfig(testCommunityConfig)).toBe(testCommunityConfig);
  });

  it("loads a complete deployment environment", () => {
    const loaded = communityConfigFromEnvironment({
      COMMUNITY_ID: testCommunityConfig.communityId,
      TWITCH_BROADCASTER_USER_ID: testCommunityConfig.twitch.broadcasterUserId,
      TWITCH_BOT_USER_ID: testCommunityConfig.twitch.botUserId,
      TWITCH_CLIENT_ID: testCommunityConfig.twitch.clientId,
      DISCORD_APPLICATION_ID: testCommunityConfig.discord.applicationId,
      DISCORD_PUBLIC_KEY: testCommunityConfig.discord.publicKey,
      DISCORD_GUILD_ID: testCommunityConfig.discord.guildId,
      DISCORD_REQUEST_CHANNEL_ID: testCommunityConfig.discord.requestChannelId,
      DISCORD_STAFF_CHANNEL_ID: testCommunityConfig.discord.staffChannelId,
      DISCORD_VOLUNTEER_ROLE_ID: testCommunityConfig.discord.volunteerRoleId,
      DISCORD_STREAMER_USER_ID: testCommunityConfig.discord.streamerUserId,
      RECIPIENT_LIMIT: String(testCommunityConfig.policies.recipientLimit),
      ATTEMPT_LIMIT: String(testCommunityConfig.policies.attemptLimit),
    });

    expect(loaded).toEqual(testCommunityConfig);
    expect(validateCommunityConfig(loaded)).toEqual([]);
  });

  it("reports missing and malformed deployment values", () => {
    const loaded = communityConfigFromEnvironment({
      COMMUNITY_ID: "butcoffee",
      RECIPIENT_LIMIT: "three",
      ATTEMPT_LIMIT: "0",
    });

    expect(validateCommunityConfig(loaded)).toEqual(
      expect.arrayContaining([
        "twitch.broadcasterUserId must be a configured numeric platform ID",
        "discord.publicKey must be a configured 64-character hexadecimal key",
        "policies.recipientLimit must be a positive integer",
        "policies.attemptLimit must be a positive integer",
      ]),
    );
  });

  it("rejects invalid policies and a shared Twitch bot identity", () => {
    const invalid = {
      ...testCommunityConfig,
      twitch: {
        ...testCommunityConfig.twitch,
        botUserId: testCommunityConfig.twitch.broadcasterUserId,
      },
      policies: { ...testCommunityConfig.policies, recipientLimit: 0, attemptLimit: 0 },
    };

    expect(validateCommunityConfig(invalid)).toEqual(
      expect.arrayContaining([
        "the Twitch broadcaster and bot IDs must be different",
        "policies.recipientLimit must be a positive integer",
        "policies.attemptLimit must be a positive integer",
      ]),
    );
  });
});
