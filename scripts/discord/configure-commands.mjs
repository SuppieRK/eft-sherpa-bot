import commandSurface from "../../config/command-surface.json" with { type: "json" };
import { loadEnvironmentValues, requireValue } from "../environment-values.mjs";

function parseEndpoint(argv, values) {
  const baseUrl = values.get("WORKER_BASE_URL");
  let raw;
  if (argv.length === 2 && argv[0] === "--endpoint" && argv[1] !== undefined) {
    raw = argv[1];
  } else if (baseUrl !== undefined) {
    raw = `${baseUrl.replace(/\/$/, "")}/webhooks/discord/interactions`;
  }
  if (raw === undefined) {
    throw new Error(
      "Set WORKER_BASE_URL or use --endpoint https://HOST/webhooks/discord/interactions",
    );
  }
  const endpoint = new URL(raw);
  if (endpoint.protocol !== "https:" || endpoint.pathname !== "/webhooks/discord/interactions") {
    throw new Error("The endpoint must be an HTTPS /webhooks/discord/interactions URL");
  }
  return endpoint.toString();
}

async function discordRequest(apiBaseUrl, path, token, method, body) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bot ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "EftSherpaBot/0.1.0",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `Discord API ${path} failed with status ${response.status}: ${typeof payload?.message === "string" ? payload.message : "unknown error"}`,
    );
  }
  return payload;
}

const values = await loadEnvironmentValues();
const endpoint = parseEndpoint(process.argv.slice(2), values);
const applicationId = requireValue(values, "DISCORD_APPLICATION_ID");
const guildId = requireValue(values, "DISCORD_GUILD_ID");
const token = requireValue(values, "DISCORD_BOT_TOKEN");
const apiBaseUrl = values.get("DISCORD_API_BASE_URL") ?? "https://discord.com/api/v10";

const application = await discordRequest(apiBaseUrl, "/applications/@me", token, "PATCH", {
  interactions_endpoint_url: endpoint,
});
if (application.id !== applicationId || application.interactions_endpoint_url !== endpoint) {
  throw new Error("Discord did not save the expected application interaction endpoint");
}

const commands = await discordRequest(
  apiBaseUrl,
  `/applications/${applicationId}/guilds/${guildId}/commands`,
  token,
  "PUT",
  [...commandSurface.public, ...commandSurface.discordViewer, ...commandSurface.discordStaff],
);

console.log(
  JSON.stringify(
    {
      ok: true,
      commands: commands.map((command) => command.name),
      endpoint: new URL(endpoint).origin,
    },
    null,
    2,
  ),
);
