const workerBaseUrl = process.env.WORKER_BASE_URL?.trim();
const diagnosticsToken = process.env.SPIKE_DIAGNOSTICS_TOKEN?.trim();
if (workerBaseUrl === undefined || diagnosticsToken === undefined) {
  throw new Error("WORKER_BASE_URL and SPIKE_DIAGNOSTICS_TOKEN are required");
}
const response = await fetch(new URL("/internal/status", workerBaseUrl), {
  headers: { Authorization: `Bearer ${diagnosticsToken}` },
});
const payload = await response.json();
if (!response.ok || payload.authorization?.ok !== true) {
  throw new Error("The Worker did not accept the new Twitch app token");
}
console.log("The Twitch app token is ready.");
