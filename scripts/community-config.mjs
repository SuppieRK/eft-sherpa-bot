const unresolvedValue = /^<[^>]+>$/;
const stablePlatformId = /^\d{5,25}$/;

function text(environment, name) {
  return environment[name]?.trim() ?? "";
}

function integer(environment, name) {
  const value = text(environment, name);
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

export function loadCommunityConfig(environment = process.env) {
  return {
    communityId: text(environment, "COMMUNITY_ID"),
    twitch: {
      broadcasterUserId: text(environment, "TWITCH_BROADCASTER_USER_ID"),
      botUserId: text(environment, "TWITCH_BOT_USER_ID"),
      clientId: text(environment, "TWITCH_CLIENT_ID"),
    },
    discord: {
      applicationId: text(environment, "DISCORD_APPLICATION_ID"),
      publicKey: text(environment, "DISCORD_PUBLIC_KEY"),
      guildId: text(environment, "DISCORD_GUILD_ID"),
      requestChannelId: text(environment, "DISCORD_REQUEST_CHANNEL_ID"),
      staffChannelId: text(environment, "DISCORD_STAFF_CHANNEL_ID"),
      volunteerRoleId: text(environment, "DISCORD_VOLUNTEER_ROLE_ID"),
      streamerUserId: text(environment, "DISCORD_STREAMER_USER_ID"),
    },
    policies: {
      recipientLimit: integer(environment, "RECIPIENT_LIMIT"),
      attemptLimit: integer(environment, "ATTEMPT_LIMIT"),
    },
  };
}

export function validateCommunityConfig(config) {
  const errors = [];
  if (config?.communityId !== "butcoffee") {
    errors.push("communityId must be butcoffee for the single-community MVP");
  }
  const stableIds = [
    ["twitch.broadcasterUserId", config?.twitch?.broadcasterUserId],
    ["twitch.botUserId", config?.twitch?.botUserId],
    ["discord.applicationId", config?.discord?.applicationId],
    ["discord.guildId", config?.discord?.guildId],
    ["discord.requestChannelId", config?.discord?.requestChannelId],
    ["discord.staffChannelId", config?.discord?.staffChannelId],
    ["discord.volunteerRoleId", config?.discord?.volunteerRoleId],
    ["discord.streamerUserId", config?.discord?.streamerUserId],
  ];
  for (const [label, value] of stableIds) {
    if (typeof value !== "string" || unresolvedValue.test(value) || !stablePlatformId.test(value)) {
      errors.push(`${label} must be a configured numeric platform ID`);
    }
  }
  if (
    typeof config?.twitch?.broadcasterUserId === "string" &&
    config.twitch.broadcasterUserId === config?.twitch?.botUserId
  ) {
    errors.push("the Twitch broadcaster and bot IDs must be different");
  }
  if (
    typeof config?.twitch?.clientId !== "string" ||
    unresolvedValue.test(config.twitch.clientId) ||
    !/^[a-z0-9]{10,64}$/i.test(config.twitch.clientId)
  ) {
    errors.push("twitch.clientId must be configured");
  }
  if (
    typeof config?.discord?.publicKey !== "string" ||
    unresolvedValue.test(config.discord.publicKey) ||
    !/^[0-9a-f]{64}$/i.test(config.discord.publicKey)
  ) {
    errors.push("discord.publicKey must be configured");
  }
  for (const policy of ["recipientLimit", "attemptLimit"]) {
    const value = config?.policies?.[policy];
    if (!Number.isInteger(value) || value <= 0) {
      errors.push(`policies.${policy} must be a positive integer`);
    }
  }
  return errors;
}

export async function requireCommunityConfig(environment = process.env) {
  const config = loadCommunityConfig(environment);
  const errors = validateCommunityConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid community configuration: ${errors.join("; ")}`);
  }
  return config;
}
