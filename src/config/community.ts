export interface CommunityConfig {
  readonly communityId: string;
  readonly twitch: {
    readonly broadcasterUserId: string;
    readonly botUserId: string;
    readonly clientId: string;
  };
  readonly discord: {
    readonly applicationId: string;
    readonly publicKey: string;
    readonly guildId: string;
    readonly requestChannelId: string;
    readonly staffChannelId: string;
    readonly volunteerRoleId: string;
    readonly streamerUserId: string;
  };
  readonly policies: {
    readonly recipientLimit: number;
    readonly attemptLimit: number;
  };
}

export interface CommunityEnvironment {
  COMMUNITY_ID?: string;
  TWITCH_BROADCASTER_USER_ID?: string;
  TWITCH_BOT_USER_ID?: string;
  TWITCH_CLIENT_ID?: string;
  DISCORD_APPLICATION_ID?: string;
  DISCORD_PUBLIC_KEY?: string;
  DISCORD_GUILD_ID?: string;
  DISCORD_REQUEST_CHANNEL_ID?: string;
  DISCORD_STAFF_CHANNEL_ID?: string;
  DISCORD_VOLUNTEER_ROLE_ID?: string;
  DISCORD_STREAMER_USER_ID?: string;
  RECIPIENT_LIMIT?: string;
  ATTEMPT_LIMIT?: string;
}

function environmentText(value: string | undefined): string {
  return value?.trim() ?? "";
}

function environmentInteger(value: string | undefined): number {
  const text = environmentText(value);
  return /^\d+$/.test(text) ? Number(text) : Number.NaN;
}

export function communityConfigFromEnvironment(environment: CommunityEnvironment): CommunityConfig {
  return {
    communityId: environmentText(environment.COMMUNITY_ID),
    twitch: {
      broadcasterUserId: environmentText(environment.TWITCH_BROADCASTER_USER_ID),
      botUserId: environmentText(environment.TWITCH_BOT_USER_ID),
      clientId: environmentText(environment.TWITCH_CLIENT_ID),
    },
    discord: {
      applicationId: environmentText(environment.DISCORD_APPLICATION_ID),
      publicKey: environmentText(environment.DISCORD_PUBLIC_KEY),
      guildId: environmentText(environment.DISCORD_GUILD_ID),
      requestChannelId: environmentText(environment.DISCORD_REQUEST_CHANNEL_ID),
      staffChannelId: environmentText(environment.DISCORD_STAFF_CHANNEL_ID),
      volunteerRoleId: environmentText(environment.DISCORD_VOLUNTEER_ROLE_ID),
      streamerUserId: environmentText(environment.DISCORD_STREAMER_USER_ID),
    },
    policies: {
      recipientLimit: environmentInteger(environment.RECIPIENT_LIMIT),
      attemptLimit: environmentInteger(environment.ATTEMPT_LIMIT),
    },
  };
}

const unresolvedValue = /^<[^>]+>$/;
const stablePlatformId = /^\d{5,25}$/;

function validateStableId(errors: string[], label: string, value: string): void {
  if (unresolvedValue.test(value) || !stablePlatformId.test(value)) {
    errors.push(`${label} must be a configured numeric platform ID`);
  }
}

function validatePositiveInteger(errors: string[], label: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    errors.push(`${label} must be a positive integer`);
  }
}

export function validateCommunityConfig(config: CommunityConfig): string[] {
  const errors: string[] = [];
  if (config.communityId !== "butcoffee") {
    errors.push("communityId must be butcoffee for the single-community MVP");
  }

  validateStableId(errors, "twitch.broadcasterUserId", config.twitch.broadcasterUserId);
  validateStableId(errors, "twitch.botUserId", config.twitch.botUserId);
  if (config.twitch.broadcasterUserId === config.twitch.botUserId) {
    errors.push("the Twitch broadcaster and bot IDs must be different");
  }
  if (
    unresolvedValue.test(config.twitch.clientId) ||
    !/^[a-z0-9]{10,64}$/i.test(config.twitch.clientId)
  ) {
    errors.push("twitch.clientId must be configured");
  }

  validateStableId(errors, "discord.applicationId", config.discord.applicationId);
  validateStableId(errors, "discord.guildId", config.discord.guildId);
  validateStableId(errors, "discord.requestChannelId", config.discord.requestChannelId);
  validateStableId(errors, "discord.staffChannelId", config.discord.staffChannelId);
  validateStableId(errors, "discord.volunteerRoleId", config.discord.volunteerRoleId);
  validateStableId(errors, "discord.streamerUserId", config.discord.streamerUserId);
  if (
    unresolvedValue.test(config.discord.publicKey) ||
    !/^[0-9a-f]{64}$/i.test(config.discord.publicKey)
  ) {
    errors.push("discord.publicKey must be a configured 64-character hexadecimal key");
  }

  validatePositiveInteger(errors, "policies.recipientLimit", config.policies.recipientLimit);
  validatePositiveInteger(errors, "policies.attemptLimit", config.policies.attemptLimit);
  return errors;
}

export function requireCommunityConfig(config: CommunityConfig): CommunityConfig {
  const errors = validateCommunityConfig(config);
  if (errors.length > 0) {
    throw new Error(`Invalid community configuration: ${errors.join("; ")}`);
  }
  return config;
}
