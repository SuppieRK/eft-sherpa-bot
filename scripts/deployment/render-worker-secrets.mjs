import { pathToFileURL } from "node:url";

export const WORKER_SECRET_NAMES = [
  "DISCORD_BOT_TOKEN",
  "SPIKE_DIAGNOSTICS_TOKEN",
  "TWITCH_APP_ACCESS_TOKEN",
  "TWITCH_EVENTSUB_SECRET",
];

export function workerSecrets(environment = process.env) {
  return Object.fromEntries(
    WORKER_SECRET_NAMES.map((name) => {
      const value = environment[name]?.trim();
      if (value === undefined || value.length === 0) {
        throw new Error(`Missing Worker secret: ${name}`);
      }
      return [name, value];
    }),
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(workerSecrets()));
}
