import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { checkedJson } from "./fetch-json.mjs";

function required(name) {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`Missing ${name}`);
  return value;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function findBookmark(value) {
  if (typeof value === "string" && /^[0-9a-f-]{16,}$/i.test(value)) return value;
  if (Array.isArray(value)) return findBookmarkIn(value);
  if (value !== null && typeof value === "object") {
    if (typeof value.bookmark === "string") return value.bookmark;
    return findBookmarkIn(Object.values(value));
  }
  return undefined;
}

function findBookmarkIn(values) {
  for (const value of values) {
    const found = findBookmark(value);
    if (found !== undefined) return found;
  }
  return undefined;
}

const workerBaseUrl = new URL(required("WORKER_BASE_URL"));
if (workerBaseUrl.protocol !== "https:") throw new Error("WORKER_BASE_URL must use HTTPS");
const diagnosticsToken = required("SPIKE_DIAGNOSTICS_TOKEN");
const [health, status, discord, twitch, d1, packageJson, migrationFiles] = await Promise.all([
  checkedJson(new URL("/health", workerBaseUrl)),
  checkedJson(new URL("/internal/status", workerBaseUrl), {
    headers: { Authorization: `Bearer ${diagnosticsToken}` },
  }),
  readJson(".artifacts/discord-validation.json"),
  readJson(".artifacts/twitch-subscription.json"),
  readJson(".artifacts/d1-bookmark.json"),
  readJson("package.json"),
  readdir("migrations"),
]);

if (health.status !== "ok" || health.configuration !== "ready") {
  throw new Error("Worker health did not report ready configuration");
}
if (status.authorization?.ok !== true) throw new Error("Twitch authorization is not healthy");
if (status.database?.hasLegacyUnassignedRequests !== false) {
  throw new Error("D1 still contains legacy unassigned requests");
}
if (discord.ok !== true) throw new Error("Discord validation did not complete");
if (!["created", "reused"].includes(twitch.action)) {
  throw new Error("Twitch subscription validation did not complete");
}
const bookmark = findBookmark(d1);
if (bookmark === undefined) throw new Error("D1 did not return a Time Travel bookmark");

const evidence = {
  schemaVersion: 1,
  repository: required("GITHUB_REPOSITORY"),
  commitSha: required("GITHUB_SHA"),
  version: packageJson.version,
  workerUrl: workerBaseUrl.origin,
  databaseName: required("D1_DATABASE_NAME"),
  migrations: migrationFiles.filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file)).sort(),
  recoveryBookmark: bookmark,
  discord: { ok: true },
  twitch: { ok: true, subscriptionAction: twitch.action },
  health: { ok: true },
  startedAt: required("DEPLOYMENT_STARTED_AT"),
  finishedAt: new Date().toISOString(),
};
await mkdir(".artifacts", { recursive: true });
await writeFile(".artifacts/deployment-evidence.json", `${JSON.stringify(evidence, null, 2)}\n`);

const summary = process.env.GITHUB_STEP_SUMMARY;
if (summary !== undefined) {
  const migrations = evidence.migrations.map((item) => `\`${item}\``).join(", ");
  await writeFile(
    summary,
    [
      "## Deployment verified",
      "",
      `- Version: \`${evidence.version}\``,
      `- Commit: \`${evidence.commitSha}\``,
      `- Worker: ${evidence.workerUrl}`,
      `- Database: \`${evidence.databaseName}\``,
      `- Migrations: ${migrations}`,
      "- Discord: ready",
      "- Twitch: ready",
      "- Worker health: ready",
      "",
    ].join("\n"),
    { flag: "a" },
  );
}
console.log("Deployment evidence is ready.");
