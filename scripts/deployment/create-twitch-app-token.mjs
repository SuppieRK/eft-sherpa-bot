import { appendFile } from "node:fs/promises";
import { loadEnvironmentValues, requireValue } from "../environment-values.mjs";

const values = await loadEnvironmentValues();
const clientId = requireValue(values, "TWITCH_CLIENT_ID");
const clientSecret = requireValue(values, "TWITCH_CLIENT_SECRET");
const authBaseUrl = values.get("TWITCH_AUTH_BASE_URL") ?? "https://id.twitch.tv/oauth2";
const response = await fetch(`${authBaseUrl.replace(/\/$/, "")}/token`, {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: "client_credentials",
  }),
});
const payload = await response.json();
if (!response.ok || typeof payload.access_token !== "string") {
  throw new Error(`Twitch app token creation failed with status ${response.status}`);
}
if (!/^[a-z0-9_-]{16,256}$/i.test(payload.access_token)) {
  throw new TypeError("Twitch returned an invalid app token");
}
const githubEnvironmentFile = process.env.GITHUB_ENV;
if (githubEnvironmentFile === undefined || githubEnvironmentFile.length === 0) {
  throw new Error("GITHUB_ENV is required so the token is not printed");
}
console.log(`::add-mask::${payload.access_token}`); // NOSONAR -- GitHub masks this validated token.
await appendFile(githubEnvironmentFile, `TWITCH_APP_ACCESS_TOKEN=${payload.access_token}\n`, {
  encoding: "utf8",
});
console.log(JSON.stringify({ ok: true }));
