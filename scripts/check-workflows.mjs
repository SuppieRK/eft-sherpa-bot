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
let ciWorkflow;
let releaseWorkflow;
for (const file of readdirSync(workflowDirectory).filter((name) => name.endsWith(".yml"))) {
  required.delete(file);
  const path = `${workflowDirectory}/${file}`;
  const contents = readFileSync(path, "utf8");
  let workflow;
  try {
    workflow = parse(contents);
    if (file === "deploy-production.yml") deploymentWorkflow = workflow;
    if (file === "refresh-twitch-token.yml") refreshWorkflow = workflow;
    if (file === "ci.yml") ciWorkflow = workflow;
    if (file === "publish-release.yml") releaseWorkflow = workflow;
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
  for (const job of Object.values(workflow.jobs ?? {})) {
    const steps = job.steps ?? [];
    const installsDependencies = steps.some(
      (step) => typeof step.run === "string" && /(^|\s)npm\s+ci(\s|$)/.test(step.run),
    );
    const installsRuntimeBinaries = steps.some(
      (step) => step.run === "npm run install:runtime-binaries",
    );
    if (installsDependencies && !installsRuntimeBinaries) {
      failures.push(`${path}: dependency installation must install the pinned runtime binaries`);
    }
    if (typeof job.uses === "string" && !/@[0-9a-f]{40}$/.test(job.uses)) {
      failures.push(`${path}: Action must use a full commit SHA: ${job.uses}`);
    }
    for (const step of steps) {
      if (typeof step.uses === "string" && !/@[0-9a-f]{40}$/.test(step.uses)) {
        failures.push(`${path}: Action must use a full commit SHA: ${step.uses}`);
      }
      const shellTokens = typeof step.run === "string" ? step.run.split(/\s+/) : [];
      if (shellTokens.includes("npx")) {
        failures.push(
          `${path}: npx can download unpinned packages; use an installed binary directly`,
        );
      }
      if (
        typeof step.run === "string" &&
        step.run.includes("npm install --global") &&
        !shellTokens.includes("--ignore-scripts")
      ) {
        failures.push(`${path}: global npm installation must disable package lifecycle scripts`);
      }
      if (
        typeof step.run === "string" &&
        shellTokens.includes("ci") &&
        shellTokens.includes("npm") &&
        !shellTokens.includes("--ignore-scripts")
      ) {
        failures.push(`${path}: npm ci must disable package lifecycle scripts`);
      }
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
const repairStepIndex = deploymentSteps.findIndex(
  (step) => step.name === "Repair legacy unassigned requests",
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
if (
  repairStepIndex <= readinessStepIndex ||
  repairStepIndex >= discordStepIndex ||
  deploymentSteps[repairStepIndex]?.run !== "node scripts/deployment/repair-legacy-requests.mjs"
) {
  failures.push(
    `${workflowDirectory}/deploy-production.yml: legacy request repair must pass after Worker readiness and before platform configuration`,
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

const ciJob = ciWorkflow?.jobs?.verify;
const ciSteps = ciJob?.steps ?? [];
const ciPushBranches = ciWorkflow?.on?.push?.branches;
const verificationStep = ciSteps.find((step) => step.name === "Verify release candidate");
const sonarStep = ciSteps.find((step) => step.name === "Analyze with SonarQube Cloud");
const sonarEnabledExpression = `\${{ secrets.SONAR_TOKEN != '' }}`;
const coverageConditionExpression = `\${{ env.SONAR_ENABLED }}`;
const sonarTokenExpression = `\${{ secrets.SONAR_TOKEN }}`;
if (
  !Array.isArray(ciPushBranches) ||
  !ciPushBranches.includes("**") ||
  ciJob?.env?.SONAR_ENABLED !== sonarEnabledExpression ||
  verificationStep?.env?.VITEST_COVERAGE !== coverageConditionExpression ||
  typeof sonarStep?.uses !== "string" ||
  !sonarStep.uses.startsWith("SonarSource/sonarqube-scan-action@") ||
  sonarStep.if !== "env.SONAR_ENABLED == 'true'" ||
  sonarStep.env?.SONAR_TOKEN !== sonarTokenExpression
) {
  failures.push(
    `${workflowDirectory}/ci.yml: CI must generate coverage and run SonarQube Cloud when SONAR_TOKEN is available`,
  );
}
const benchmarkStep = ciSteps.find((step) => step.name === "Run fully local D1 benchmark");
const benchmarkArtifactStep = ciSteps.find((step) => step.name === "Upload benchmark evidence");
const benchmarkCondition = "github.event_name == 'pull_request' || github.ref == 'refs/heads/main'";
if (
  benchmarkStep?.run !== "npm run benchmark:d1" ||
  benchmarkStep.if !== benchmarkCondition ||
  benchmarkArtifactStep?.if !== `success() && (${benchmarkCondition})`
) {
  failures.push(`${workflowDirectory}/ci.yml: CI must generate local D1 benchmark evidence`);
}
const releaseSteps = releaseWorkflow?.jobs?.publish?.steps ?? [];
const releaseGate = releaseSteps.find(
  (step) => step.name === "Require successful CI and deployment for this commit",
);
if (
  typeof releaseGate?.run !== "string" ||
  !releaseGate.run.includes("--workflow ci.yml") ||
  !releaseGate.run.includes("--workflow deploy-production.yml")
) {
  failures.push(
    `${workflowDirectory}/publish-release.yml: release must require CI benchmark evidence and deployment for the commit`,
  );
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exitCode = 1;
} else {
  console.log("GitHub workflow checks passed.");
}
