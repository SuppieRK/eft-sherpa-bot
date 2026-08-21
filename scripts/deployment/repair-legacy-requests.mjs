import { pathToFileURL } from "node:url";
import { checkedJson } from "./fetch-json.mjs";

const DEFAULT_MAX_BATCHES = 100;

function requireValue(environment, name) {
  const value = environment[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`Missing ${name}`);
  return value;
}

export async function repairLegacyRequests({
  workerBaseUrl,
  diagnosticsToken,
  maxBatches = DEFAULT_MAX_BATCHES,
  fetcher = fetch,
}) {
  if (!Number.isInteger(maxBatches) || maxBatches < 1) {
    throw new Error("maxBatches must be positive");
  }
  if (typeof diagnosticsToken !== "string" || diagnosticsToken.trim().length === 0) {
    throw new Error("SPIKE_DIAGNOSTICS_TOKEN is required");
  }
  const baseUrl = new URL(workerBaseUrl);
  if (baseUrl.protocol !== "https:") throw new Error("WORKER_BASE_URL must use HTTPS");

  let repaired = 0;
  for (let batch = 1; batch <= maxBatches; batch += 1) {
    // Deployment repair is intentionally sequential so each batch observes the preceding commit.
    // oxlint-disable-next-line no-await-in-loop
    const result = await checkedJson(
      new URL("/internal/repair-unassigned-requests", baseUrl),
      {
        method: "POST",
        headers: { Authorization: `Bearer ${diagnosticsToken}` },
      },
      fetcher,
    );
    if (!Number.isInteger(result.repaired) || result.repaired < 0) {
      throw new TypeError("Legacy repair returned an invalid repaired count");
    }
    if (typeof result.hasMore !== "boolean") {
      throw new TypeError("Legacy repair returned an invalid continuation flag");
    }
    repaired += result.repaired;
    if (!result.hasMore) return { batches: batch, repaired };
  }
  throw new Error(`Legacy repair still has work after ${maxBatches} batches`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await repairLegacyRequests({
    workerBaseUrl: requireValue(process.env, "WORKER_BASE_URL"),
    diagnosticsToken: requireValue(process.env, "SPIKE_DIAGNOSTICS_TOKEN"),
  });
  console.log(
    `Legacy request repair completed in ${result.batches} batch(es): ${result.repaired}.`,
  );
}
