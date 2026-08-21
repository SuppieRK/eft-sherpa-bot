import { randomBytes } from "node:crypto";
import { chmod, readFile, writeFile } from "node:fs/promises";

const OPERATOR_FILE = ".dev.vars.operator";
const WORKER_FILE = ".dev.vars";
const REQUIRED_SCOPES = ["user:read:chat", "user:write:chat", "user:bot"];
const TWITCH_DEVICE_ACTIVATION_URL = "https://www.twitch.tv/activate";

function parseEnvironmentFile(contents) {
  const values = new Map();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const separator = line.indexOf("=");
    if (separator < 1) {
      throw new Error(`Invalid environment line: ${rawLine}`);
    }
    const name = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (values.has(name)) {
      throw new Error(`Duplicate environment value: ${name}`);
    }
    values.set(name, value);
  }
  return values;
}

function requireValue(values, name) {
  const value = values.get(name);
  if (value === undefined || value.length === 0) {
    throw new Error(`Missing required value in ${OPERATOR_FILE}: ${name}`);
  }
  return value;
}

async function readEnvironmentFile(path) {
  try {
    return parseEnvironmentFile(await readFile(path, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT") {
      return new Map();
    }
    throw error;
  }
}

async function writeEnvironmentFile(path, values) {
  const lines = [...values.entries()].map(([name, value]) => `${name}=${value}`);
  const contents = `${lines.join("\n")}\n`;
  await writeFile(path, contents, { encoding: "utf8", mode: 0o600 });
  await chmod(path, 0o600);
}

async function postForm(url, values) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(values),
  });
  const payload = await response.json();
  return { response, payload };
}

async function startDeviceAuthorization(clientId) {
  const { response, payload } = await postForm("https://id.twitch.tv/oauth2/device", {
    client_id: clientId,
    scopes: REQUIRED_SCOPES.join(" "),
  });
  if (!response.ok) {
    throw new Error(`Twitch device authorization failed with status ${response.status}`);
  }
  if (
    typeof payload.device_code !== "string" ||
    typeof payload.user_code !== "string" ||
    typeof payload.verification_uri !== "string"
  ) {
    throw new TypeError("Twitch returned an invalid device authorization response");
  }
  if (!/^[a-z0-9-]{4,32}$/i.test(payload.user_code)) {
    throw new TypeError("Twitch returned an invalid device authorization code");
  }
  const verificationUrl = new URL(payload.verification_uri);
  if (`${verificationUrl.origin}${verificationUrl.pathname}` !== TWITCH_DEVICE_ACTIVATION_URL) {
    throw new TypeError("Twitch returned an unexpected device authorization URL");
  }
  return payload;
}

async function waitForDeviceAuthorization(clientId, device) {
  let intervalSeconds = Math.max(Number(device.interval) || 5, 1);
  const deadline = Date.now() + Math.max(Number(device.expires_in) || 600, 60) * 1_000;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, intervalSeconds * 1_000));
    const { response, payload } = await postForm("https://id.twitch.tv/oauth2/token", {
      client_id: clientId,
      scopes: REQUIRED_SCOPES.join(" "),
      device_code: device.device_code,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    });
    if (response.ok) {
      if (typeof payload.access_token !== "string" || typeof payload.refresh_token !== "string") {
        throw new TypeError("Twitch returned an invalid token response");
      }
      return payload;
    }
    if (payload?.message === "authorization_pending") {
      continue;
    }
    if (payload?.message === "slow_down") {
      intervalSeconds += 5;
      continue;
    }
    throw new Error(`Twitch authorization failed: ${payload?.message ?? response.status}`);
  }
  throw new Error("Twitch authorization expired before approval");
}

async function validateUserToken(accessToken, expectedLogin, expectedClientId) {
  const response = await fetch("https://id.twitch.tv/oauth2/validate", {
    headers: { Authorization: `OAuth ${accessToken}` },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Twitch token validation failed with status ${response.status}`);
  }
  if (payload.client_id !== expectedClientId) {
    throw new Error("The authorized token belongs to a different Twitch application");
  }
  if (String(payload.login).toLowerCase() !== expectedLogin.toLowerCase()) {
    throw new Error(`Authorized the wrong Twitch account; expected ${expectedLogin}`);
  }
  const scopes = new Set(Array.isArray(payload.scopes) ? payload.scopes : []);
  const missingScopes = REQUIRED_SCOPES.filter((scope) => !scopes.has(scope));
  if (missingScopes.length > 0) {
    throw new Error(`The Twitch token is missing scopes: ${missingScopes.join(", ")}`);
  }
  if (typeof payload.user_id !== "string" || !/^\d+$/.test(payload.user_id)) {
    throw new TypeError("Twitch token validation did not return a bot user ID");
  }
  return payload;
}

async function createAppAccessToken(clientId, clientSecret) {
  const { response, payload } = await postForm("https://id.twitch.tv/oauth2/token", {
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  });
  if (!response.ok || typeof payload.access_token !== "string") {
    throw new Error(`Twitch app token creation failed with status ${response.status}`);
  }
  return payload;
}

async function getTwitchUser(clientId, accessToken, login) {
  const url = new URL("https://api.twitch.tv/helix/users");
  url.searchParams.set("login", login);
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Client-Id": clientId,
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Twitch user lookup failed with status ${response.status}`);
  }
  const user = Array.isArray(payload.data) ? payload.data[0] : undefined;
  if (typeof user?.id !== "string" || !/^\d+$/.test(user.id)) {
    throw new TypeError(`Twitch user was not found: ${login}`);
  }
  return user;
}

const operatorValues = await readEnvironmentFile(OPERATOR_FILE);
const clientId = requireValue(operatorValues, "TWITCH_CLIENT_ID");
const clientSecret = requireValue(operatorValues, "TWITCH_CLIENT_SECRET");
const appTokenOnly = process.argv.includes("--app-token-only");

if (!appTokenOnly) {
  const botLogin = requireValue(operatorValues, "TWITCH_BOT_LOGIN").toLowerCase();
  const broadcasterLogin = requireValue(operatorValues, "TWITCH_BROADCASTER_LOGIN").toLowerCase();
  const device = await startDeviceAuthorization(clientId);
  console.log("Authorize with the BOT Twitch account:");
  console.log(TWITCH_DEVICE_ACTIVATION_URL);
  console.log(`Code: ${device.user_code}`); // NOSONAR -- Strict validation prevents log injection.
  console.log("Waiting for authorization...");

  const userToken = await waitForDeviceAuthorization(clientId, device);
  const validation = await validateUserToken(userToken.access_token, botLogin, clientId);
  const broadcaster = await getTwitchUser(clientId, userToken.access_token, broadcasterLogin);
  operatorValues.set("TWITCH_REFRESH_TOKEN", userToken.refresh_token);
  operatorValues.set("TWITCH_BOT_USER_ID", validation.user_id);
  operatorValues.set("TWITCH_BROADCASTER_USER_ID", broadcaster.id);
}

const appToken = await createAppAccessToken(clientId, clientSecret);
const workerValues = await readEnvironmentFile(WORKER_FILE);
workerValues.set(
  "TWITCH_EVENTSUB_SECRET",
  workerValues.get("TWITCH_EVENTSUB_SECRET") || randomBytes(32).toString("hex"),
);
workerValues.set("TWITCH_APP_ACCESS_TOKEN", appToken.access_token);
workerValues.delete("TWITCH_USER_ACCESS_TOKEN");
workerValues.set(
  "SPIKE_DIAGNOSTICS_TOKEN",
  workerValues.get("SPIKE_DIAGNOSTICS_TOKEN") || randomBytes(32).toString("hex"),
);
await writeEnvironmentFile(WORKER_FILE, workerValues);
operatorValues.set("TWITCH_APP_ACCESS_TOKEN", appToken.access_token);
await writeEnvironmentFile(OPERATOR_FILE, operatorValues);

if (appTokenOnly) {
  console.log(
    JSON.stringify(
      {
        appTokenReady: true,
        secretFilesUpdated: [WORKER_FILE, OPERATOR_FILE],
      },
      null,
      2,
    ),
  );
} else {
  console.log(
    JSON.stringify(
      {
        authorizationReady: true,
        scopes: REQUIRED_SCOPES,
        identityValuesUpdated: ["TWITCH_BOT_USER_ID", "TWITCH_BROADCASTER_USER_ID"],
        secretFilesUpdated: [WORKER_FILE, OPERATOR_FILE],
      },
      null,
      2,
    ),
  );
}
