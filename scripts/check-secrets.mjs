import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const trackedOrPending = execFileSync(
  "git",
  ["ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8" },
)
  .split("\0")
  .filter(Boolean);

const forbiddenNames = [
  /(^|\/)\.env(?:\.|$)/,
  /(^|\/)\.dev\.vars(?:\.|$)/,
  /(^|\/)wrangler\..+\.local\.jsonc$/,
];

const allowedExamples = new Set([".dev.vars.example"]);
const secretPatterns = [
  { name: "private key", pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "Twitch OAuth token", pattern: /oauth:[a-z0-9]{30}/i },
  {
    name: "Discord bot token",
    pattern: /(?:M|N)[A-Za-z\d_-]{23}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,}/,
  },
  { name: "GitHub token", pattern: /gh[pousr]_[A-Za-z0-9]{30,}/ },
  {
    name: "pilot platform identifier",
    pattern: new RegExp(
      [
        ["5455", "9231"],
        ["1528", "691240"],
        ["153785", "2975811141702"],
        ["125569", "1577813372939"],
        ["153785", "5759042220063"],
        ["153785", "5778822684742"],
        ["153785", "5946024292382"],
        ["147319", "741965533184"],
        ["d6j6zb6ysv", "kn5c6ohq5jhyuabo9na1"],
        ["3a7c72fda13a3144", "9996309a34b034e9125ed1f1c20cf6431314b3bc0357ece4"],
      ]
        .map((parts) => parts.join(""))
        .join("|"),
    ),
  },
];

const failures = [];
for (const file of trackedOrPending) {
  if (!allowedExamples.has(file) && forbiddenNames.some((pattern) => pattern.test(file))) {
    failures.push(`${file}: secret-bearing filename must not be tracked`);
    continue;
  }

  let contents;
  try {
    contents = readFileSync(file, "utf8");
  } catch {
    continue;
  }

  for (const secretPattern of secretPatterns) {
    if (secretPattern.pattern.test(contents)) {
      failures.push(`${file}: possible ${secretPattern.name}`);
    }
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Secret scan passed for ${trackedOrPending.length} repository files.`);
}
