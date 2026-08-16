import type { CommunityConfig } from "../../src/config/community";

export const testCommunityConfig = {
  communityId: "butcoffee",
  twitch: {
    broadcasterUserId: "100000000000001",
    botUserId: "100000000000002",
    clientId: "testclientid1234567890",
  },
  discord: {
    applicationId: "200000000000001",
    publicKey: "a".repeat(64),
    guildId: "200000000000002",
    requestChannelId: "200000000000003",
    staffChannelId: "200000000000004",
    volunteerRoleId: "200000000000005",
    streamerUserId: "200000000000006",
  },
  policies: {
    recipientLimit: 4,
    attemptLimit: 3,
  },
} satisfies CommunityConfig;
