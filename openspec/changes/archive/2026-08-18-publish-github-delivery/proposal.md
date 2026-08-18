## Why

The accepted private pilot cannot be handed to the streamer safely while deployment configuration, patch delivery, and operator instructions remain tied to the maintainer's local environment. The project now needs a clean public release and a repeatable GitHub-based delivery path that a non-technical streamer can operate.

## What Changes

- Publish `SuppieRK/eft-sherpa-bot` as an MIT-licensed repository with one sanitized initial Git commit.
- Move streamer-specific public IDs and policy values from tracked files to GitHub environment variables and Cloudflare Worker variables.
- Replace the internal-test deployment with a protected manual production workflow that works without local tools.
- Add an upstream deployment and smoke-test gate for the exact commit of every release.
- Add semantic GitHub releases, fork-based patch delivery, deployment evidence, token refresh, and recovery procedures.
- Add browser-only fork, environment, update, and deployment instructions for the streamer.
- Write all public-facing documentation in ASD-STE100 Simplified Technical English, except the canonical MIT license text.

## Capabilities

### New Capabilities

- `github-fork-delivery`: Streamer-owned fork creation, environment setup, patch synchronization, and browser-only deployment.
- `verified-public-releases`: Sanitized publication, upstream deployment evidence, smoke-test gating, and semantic releases.
- `simplified-public-documentation`: Public operator and streamer documentation written in ASD-STE100 Simplified Technical English.

### Modified Capabilities

- `fixed-mvp-configuration`: Load community platform IDs and policy values from deployment variables instead of a tracked pilot-specific JSON file.
- `mvp-deployment`: Replace the internal-test workflow with protected, repeatable production deployment and token-maintenance workflows.

## Impact

The change affects Worker configuration loading, GitHub Actions, deployment and platform setup scripts, repository metadata, public documentation, release policy, and tests. Production remains a single-community Cloudflare Worker with one D1 database and the existing Discord and Twitch behavior.
