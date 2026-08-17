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
let deploymentWorkflow;
let refreshWorkflow;
for (const file of readdirSync(workflowDirectory).filter((name) => name.endsWith(".yml"))) {
  required.delete(file);
  const path = `${workflowDirectory}/${file}`;
  const contents = readFileSync(path, "utf8");
  let workflow;
  try {
    workflow = parse(contents);
    if (file === "deploy-production.yml") deploymentWorkflow = workflow;
    if (file === "refresh-twitch-token.yml") refreshWorkflow = workflow;
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

const deploymentSteps = deploymentWorkflow?.jobs?.deploy?.steps ?? [];
const workerDeploy = deploymentSteps.find(
  (step) => typeof step.uses === "string" && step.uses.startsWith("cloudflare/wrangler-action@"),
);
if (workerDeploy?.with?.secrets !== undefined) {
  failures.push(
    `${workflowDirectory}/deploy-production.yml: Wrangler Action secret upload can target the local Worker`,
  );
}
const workerSecretUpload = deploymentSteps.find((step) => step.name === "Upload Worker secrets");
if (
  typeof workerSecretUpload?.run !== "string" ||
  !workerSecretUpload.run.includes(
    'wrangler secret bulk --config config/wrangler.github.jsonc --name "$WORKER_NAME"',
  )
) {
  failures.push(
    `${workflowDirectory}/deploy-production.yml: Worker secrets must use the production config and Worker name`,
  );
}
const readinessStepIndex = deploymentSteps.findIndex(
  (step) => step.name === "Wait for Worker readiness",
);
const secretStepIndex = deploymentSteps.findIndex((step) => step.name === "Upload Worker secrets");
const discordStepIndex = deploymentSteps.findIndex(
  (step) => step.name === "Configure Discord commands and endpoint",
);
if (
  readinessStepIndex <= secretStepIndex ||
  readinessStepIndex >= discordStepIndex ||
  deploymentSteps[readinessStepIndex]?.run !== "node scripts/deployment/wait-for-worker.mjs"
) {
  failures.push(
    `${workflowDirectory}/deploy-production.yml: Worker readiness must pass between secret upload and platform configuration`,
  );
}

const refreshSteps = refreshWorkflow?.jobs?.refresh?.steps ?? [];
const tokenUploadIndex = refreshSteps.findIndex((step) => step.name === "Upload Twitch app token");
const tokenReadinessIndex = refreshSteps.findIndex(
  (step) => step.name === "Wait for Worker readiness",
);
if (
  tokenReadinessIndex <= tokenUploadIndex ||
  refreshSteps[tokenReadinessIndex]?.run !== "node scripts/deployment/wait-for-worker.mjs"
) {
  failures.push(
    `${workflowDirectory}/refresh-twitch-token.yml: Worker readiness must pass after Twitch token upload`,
  );
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("GitHub workflow checks passed.");
}
