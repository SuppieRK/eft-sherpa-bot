import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return markdownFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".md") ? [entryPath] : [];
  });
}

const publicMarkdown = [
  "README.md",
  "CONTRIBUTING.md",
  "SECURITY.md",
  ".github/PULL_REQUEST_TEMPLATE.md",
  ...markdownFiles("docs"),
];
const publicInterfaceFiles = [
  ...publicMarkdown,
  ".github/ISSUE_TEMPLATE/bug_report.yml",
  ...readdirSync(".github/workflows")
    .filter((file) => file.endsWith(".yml"))
    .map((file) => `.github/workflows/${file}`),
];
const failures = [];
const installerSetup = readFileSync("docs/INSTALLER_SETUP.md", "utf8");
const productionWorkflow = readFileSync(
  ".github/workflows/check-production-configuration.yml",
  "utf8",
);
const discouraged = [
  { pattern: /\bclick\b/gi, replacement: "select" },
  { pattern: /\bjust\b/gi, replacement: "a precise instruction" },
  { pattern: /\bplease\b/gi, replacement: "a direct instruction" },
  { pattern: /\bsimply\b/gi, replacement: "a precise instruction" },
  {
    pattern:
      /\b(?:can't|cannot've|couldn't|didn't|doesn't|don't|hasn't|haven't|isn't|mustn't|shouldn't|wasn't|weren't|won't|wouldn't)\b/gi,
    replacement: "the full form",
  },
];

const environmentTableHeader =
  "| Name | GitHub type | Enter this value | Get it here | Format/check |";
if (!installerSetup.includes(environmentTableHeader)) {
  failures.push("docs/INSTALLER_SETUP.md: environment tables need the exact source columns");
}
if (installerSetup.includes("| Name | Source |")) {
  failures.push("docs/INSTALLER_SETUP.md: replace the ambiguous Source column");
}

const documentedEnvironment = new Map();
for (const match of installerSetup.matchAll(/^\| `([A-Z0-9_]+)` \| `(Variable|Secret)` \|/gm)) {
  const [, name, type] = match;
  if (documentedEnvironment.has(name)) {
    failures.push(`docs/INSTALLER_SETUP.md: duplicate environment value ${name}`);
  }
  documentedEnvironment.set(name, type);
}

const requiredEnvironment = new Map();
for (const match of productionWorkflow.matchAll(
  /^\s{6}([A-Z0-9_]+): \$\{\{ (vars|secrets)\.\1 \}\}$/gm,
)) {
  const [, name, source] = match;
  requiredEnvironment.set(name, source === "vars" ? "Variable" : "Secret");
}

for (const [name, type] of requiredEnvironment) {
  const documentedType = documentedEnvironment.get(name);
  if (documentedType === undefined) {
    failures.push(`docs/INSTALLER_SETUP.md: missing production environment value ${name}`);
  } else if (documentedType !== type) {
    failures.push(
      `docs/INSTALLER_SETUP.md: ${name} must use GitHub type ${type}, not ${documentedType}`,
    );
  }
}

for (const name of documentedEnvironment.keys()) {
  if (!requiredEnvironment.has(name)) {
    failures.push(`docs/INSTALLER_SETUP.md: undocumented production contract value ${name}`);
  }
}

for (const file of publicInterfaceFiles) {
  const contents = readFileSync(file, "utf8");
  for (const rule of discouraged) {
    for (const match of contents.matchAll(rule.pattern)) {
      failures.push(`${file}: use ${rule.replacement} instead of ${match[0]}`);
    }
  }
}

for (const file of publicMarkdown) {
  const contents = readFileSync(file, "utf8");
  let fenced = false;
  for (const [index, rawLine] of contents.split(/\r?\n/).entries()) {
    const line = rawLine.trim();
    if (line.startsWith("```")) {
      fenced = !fenced;
      continue;
    }
    if (
      fenced ||
      line.length === 0 ||
      /^[#>|*-]/.test(line) ||
      /^\d+\./.test(line) ||
      line.includes("|") ||
      line.includes("http")
    ) {
      continue;
    }
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const words = sentence.split(/\s+/).filter(Boolean);
      if (words.length > 40)
        failures.push(`${file}:${index + 1}: sentence has ${words.length} words`);
    }
  }

  for (const match of contents.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    const target = match[1].split("#", 1)[0];
    if (target.length === 0) continue;
    if (target.startsWith("https://")) continue;
    if (/^[a-z]+:/i.test(target)) {
      failures.push(`${file}: public links must use HTTPS: ${target}`);
      continue;
    }
    const resolved = path.resolve(path.dirname(file), target);
    if (!existsSync(resolved)) failures.push(`${file}: missing local link target ${target}`);
  }
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log(`Documentation checks passed for ${publicInterfaceFiles.length} public files.`);
}
