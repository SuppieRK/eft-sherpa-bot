import { readFile, writeFile } from "node:fs/promises";

function required(name) {
  const value = process.env[name]?.trim();
  if (value === undefined || value.length === 0) throw new Error(`Missing ${name}`);
  return value;
}

const version = required("RELEASE_VERSION");
if (!/^v0\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/.test(version)) {
  throw new Error("The MVP release version must use v0.MINOR.PATCH");
}
const packageJson = JSON.parse(await readFile("package.json", "utf8"));
if (packageJson.version !== version.slice(1)) {
  throw new Error(`package.json version ${packageJson.version} does not match ${version}`);
}
const notes = [
  `# ${version}`,
  "",
  "## Migrations",
  "",
  required("RELEASE_MIGRATIONS"),
  "",
  "## Compatibility",
  "",
  required("RELEASE_COMPATIBILITY"),
  "",
  "## Operator actions",
  "",
  required("RELEASE_OPERATOR_ACTIONS"),
  "",
  "## Rollback",
  "",
  required("RELEASE_ROLLBACK"),
  "",
].join("\n");
await writeFile(".artifacts/release-notes.md", notes);
console.log(`Release notes are ready for ${version}.`);
