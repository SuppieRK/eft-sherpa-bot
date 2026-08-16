import { loadCommunityConfig, validateCommunityConfig } from "./community-config.mjs";

const errors = validateCommunityConfig(loadCommunityConfig());
if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Community configuration is ready for live deployment.");
}
