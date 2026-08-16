import { loadEnvironmentValues, requireValue } from "../environment-values.mjs";

const SNOWFLAKE_PATTERN = /^\d{17,20}$/;
const PUBLIC_KEY_PATTERN = /^[a-f0-9]{64}$/i;

function requireSnowflake(values, name) {
  const value = requireValue(values, name);
  if (!SNOWFLAKE_PATTERN.test(value)) {
    throw new Error(`${name} must be a numeric Discord ID`);
  }
  return value;
}

async function discordRequest(apiBaseUrl, path, token) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      Authorization: `Bot ${token}`,
      "User-Agent": "EftSherpaBot/0.1.0",
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Discord API ${path} failed with status ${response.status}`);
  }
  return payload;
}

const values = await loadEnvironmentValues();
const apiBaseUrl = values.get("DISCORD_API_BASE_URL") ?? "https://discord.com/api/v10";
const applicationId = requireSnowflake(values, "DISCORD_APPLICATION_ID");
const publicKey = requireValue(values, "DISCORD_PUBLIC_KEY");
const token = requireValue(values, "DISCORD_BOT_TOKEN");
const guildId = requireSnowflake(values, "DISCORD_GUILD_ID");
const requestChannelId = requireSnowflake(values, "DISCORD_REQUEST_CHANNEL_ID");
const staffChannelId = requireSnowflake(values, "DISCORD_STAFF_CHANNEL_ID");
const volunteerRoleId = requireSnowflake(values, "DISCORD_VOLUNTEER_ROLE_ID");
const streamerUserId = requireSnowflake(values, "DISCORD_STREAMER_USER_ID");

if (!PUBLIC_KEY_PATTERN.test(publicKey)) {
  throw new Error("DISCORD_PUBLIC_KEY must be a 64-character hexadecimal key");
}
if (requestChannelId === staffChannelId) {
  throw new Error("The Discord request and staff channels must be different");
}
const [application, bot, guild, requestChannel, staffChannel, roles] = await Promise.all([
  discordRequest(apiBaseUrl, "/applications/@me", token),
  discordRequest(apiBaseUrl, "/users/@me", token),
  discordRequest(apiBaseUrl, `/guilds/${guildId}`, token),
  discordRequest(apiBaseUrl, `/channels/${requestChannelId}`, token),
  discordRequest(apiBaseUrl, `/channels/${staffChannelId}`, token),
  discordRequest(apiBaseUrl, `/guilds/${guildId}/roles`, token),
  discordRequest(apiBaseUrl, `/guilds/${guildId}/members/${streamerUserId}`, token),
]);

if (application.id !== applicationId) {
  throw new Error("The Discord bot token belongs to a different application ID");
}
if (application.verify_key !== publicKey) {
  throw new Error("The Discord public key does not match the bot application");
}
if (bot.bot !== true) {
  throw new Error("The Discord token does not identify a bot user");
}
if (guild.id !== guildId) {
  throw new Error("The Discord bot is not installed in the configured server");
}

for (const [label, channel, expectedId] of [
  ["request", requestChannel, requestChannelId],
  ["staff", staffChannel, staffChannelId],
]) {
  if (channel.id !== expectedId || channel.guild_id !== guildId || channel.type !== 0) {
    throw new Error(`The configured ${label} channel is not a text channel in the test server`);
  }
}

const volunteerRole = Array.isArray(roles)
  ? roles.find((role) => role.id === volunteerRoleId)
  : undefined;
if (volunteerRole === undefined || volunteerRole.id === guildId) {
  throw new Error("The configured volunteer role was not found in the test server");
}

console.log(
  JSON.stringify(
    {
      ok: true,
      verified: [
        "application",
        "bot",
        "server",
        "request-channel",
        "staff-channel",
        "volunteer-role",
        "streamer",
      ],
    },
    null,
    2,
  ),
);
