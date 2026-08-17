import { pathToFileURL } from "node:url";
import { checkedJson } from "./fetch-json.mjs";

const DEFAULT_ATTEMPTS = 12;
const DEFAULT_DELAY_MS = 3_000;

function requireValue(environment, name) {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`Missing ${name}`);
  return value;
}

function assertReady(health, status) {
  if (health.status !== "ok" || health.configuration !== "ready") {
    throw new Error("Worker health did not report ready configuration");
  }
  if (status.authorization?.ok !== true) {
    throw new Error("Twitch authorization is not healthy");
  }
  if (typeof status.database?.tableCount !== "number") {
    throw new Error("D1 diagnostics are not ready");
  }
}

export async function waitForWorker({
  workerBaseUrl,
  diagnosticsToken,
  attempts = DEFAULT_ATTEMPTS,
  delayMs = DEFAULT_DELAY_MS,
  fetcher = fetch,
  sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
  onRetry = () => undefined,
}) {
  if (!Number.isInteger(attempts) || attempts < 1) throw new Error("attempts must be positive");
  if (!Number.isInteger(delayMs) || delayMs < 0) throw new Error("delayMs must not be negative");
  if (typeof diagnosticsToken !== "string" || diagnosticsToken.trim().length === 0) {
    throw new Error("SPIKE_DIAGNOSTICS_TOKEN is required");
  }

  const baseUrl = new URL(workerBaseUrl);
  if (baseUrl.protocol !== "https:") throw new Error("WORKER_BASE_URL must use HTTPS");
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const [health, status] = await Promise.all([
        checkedJson(new URL("/health", baseUrl), undefined, fetcher),
        checkedJson(
          new URL("/internal/status", baseUrl),
          { headers: { Authorization: `Bearer ${diagnosticsToken}` } },
          fetcher,
        ),
      ]);
      assertReady(health, status);
      return { attempt, health, status };
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      onRetry({ attempt, attempts, error });
      await sleep(delayMs);
    }
  }

  throw new Error(
    `Worker did not become ready after ${attempts} attempts: ${lastError?.message ?? "unknown error"}`,
    { cause: lastError },
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await waitForWorker({
    workerBaseUrl: requireValue(process.env, "WORKER_BASE_URL"),
    diagnosticsToken: requireValue(process.env, "SPIKE_DIAGNOSTICS_TOKEN"),
    onRetry: ({ attempt, attempts, error }) => {
      console.error(`Worker readiness attempt ${attempt}/${attempts} failed: ${error.message}`);
    },
  });
  console.log(`The Worker is ready after ${result.attempt} attempt(s).`);
}
