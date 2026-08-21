import { createHash } from "node:crypto";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const migrationDirectory = path.join(root, "migrations");
const manifest = JSON.parse(
  readFileSync(path.join(root, "config", "migration-checksums.json"), "utf8"),
);
const compareMigrationNames = (left, right) => left.localeCompare(right, "en-US");
const files = readdirSync(migrationDirectory)
  .filter((file) => /^\d{4}_[a-z0-9_]+\.sql$/.test(file))
  .sort(compareMigrationNames);
const recordedMigrations = manifest.migrations ?? {};
const recorded = Object.keys(recordedMigrations).sort(compareMigrationNames);
const recordNewMigrations = process.argv.slice(2).includes("--record");

if (manifest.version !== 1) {
  throw new Error("Unsupported migration checksum manifest version");
}

const checksums = {};
for (const [index, file] of files.entries()) {
  const expectedPrefix = String(index + 1).padStart(4, "0");
  if (!file.startsWith(`${expectedPrefix}_`)) {
    throw new Error(`Migration sequence is not contiguous at ${file}`);
  }
  const actual = createHash("sha256")
    .update(readFileSync(path.join(migrationDirectory, file)))
    .digest("hex");
  const recordedChecksum = recordedMigrations[file];
  if (recordedChecksum !== undefined && recordedChecksum !== actual) {
    throw new Error(`Applied migration changed: ${file}`);
  }
  checksums[file] = actual;
}

for (const file of recorded) {
  if (!files.includes(file)) {
    throw new Error(`Recorded migration is missing: ${file}`);
  }
}

if (recordNewMigrations) {
  const added = files.filter((file) => recordedMigrations[file] === undefined);
  writeFileSync(
    path.join(root, "config", "migration-checksums.json"),
    `${JSON.stringify({ version: 1, migrations: checksums }, null, 2)}\n`,
  );
  console.log(
    added.length === 0
      ? `Verified ${files.length} immutable D1 migrations; no new checksums to record`
      : `Recorded ${added.length} new immutable D1 migration checksum(s)`,
  );
} else {
  if (JSON.stringify(files) !== JSON.stringify(recorded)) {
    throw new Error(
      "Migration checksum manifest does not match the numbered SQL files; run npm run migrations:record after the new SQL is final",
    );
  }
  console.log(`Verified ${files.length} immutable D1 migrations`);
}
