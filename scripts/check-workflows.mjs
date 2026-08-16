import { readdirSync, readFileSync } from "node:fs";
import { parse } from "yaml";

const workflowDirectory = ".github/workflows";
const required = new Set([
  "ci.yml",
  "check-production-configuration.yml",
  "deploy-production.yml",
  "publish-release.yml",
  "refresh-twitch-token.yml",
]);
const failures = [];
for (const file of readdirSync(workflowDirectory).filter((name) => name.endsWith(".yml"))) {
  required.delete(file);
  const path = `${workflowDirectory}/${file}`;
  const contents = readFileSync(path, "utf8");
  let workflow;
  try {
    workflow = parse(contents);
  } catch (error) {
    failures.push(`${path}: invalid YAML: ${error.message}`);
    continue;
  }
  if (workflow.permissions === undefined)
    failures.push(`${path}: top-level permissions are required`);
  if (
    workflow.pull_request_target !== undefined ||
    workflow.on?.pull_request_target !== undefined
  ) {
    failures.push(`${path}: pull_request_target is forbidden`);
  }
  for (const match of contents.matchAll(/^\s*uses:\s*([^\s#]+).*$/gm)) {
    const reference = match[1];
    if (!/@[0-9a-f]{40}$/.test(reference)) {
      failures.push(`${path}: Action must use a full commit SHA: ${reference}`);
    }
  }
  for (const job of Object.values(workflow.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (
        typeof step.uses === "string" &&
        step.uses.startsWith("actions/upload-artifact@") &&
        typeof step.with?.path === "string" &&
        step.with.path.split(/\r?\n/).some((artifactPath) => artifactPath.trim().startsWith(".")) &&
        step.with?.["include-hidden-files"] !== true
      ) {
        failures.push(`${path}: uploads from hidden paths must set include-hidden-files to true`);
      }
    }
  }
}
for (const file of required)
  failures.push(`${workflowDirectory}/${file}: required workflow is missing`);

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("GitHub workflow checks passed.");
}
