## ADDED Requirements

### Requirement: Streamer can create a deployable fork in a browser
The public documentation SHALL give the streamer browser-only instructions to fork `SuppieRK/eft-sherpa-bot`, copy only `main`, enable GitHub Actions, and create a `production` environment.

#### Scenario: Streamer follows first-time GitHub setup
- **WHEN** the streamer follows the documented GitHub controls
- **THEN** the streamer owns an enabled fork with a protected `production` environment and does not use a shell

### Requirement: Fork configuration remains outside tracked files
Streamer-specific platform IDs, policy values, infrastructure identifiers, and credentials SHALL be stored in GitHub environment variables or secrets and SHALL NOT require tracked fork changes.

#### Scenario: Upstream patch is available
- **WHEN** the streamer selects Sync fork
- **THEN** community configuration does not create a merge conflict

### Requirement: Production deployment requires explicit approval
The fork SHALL expose one manual `Deploy production` workflow that verifies the selected `main` commit and SHALL not access production environment secrets before approval.

#### Scenario: Streamer deploys an accepted patch
- **WHEN** CI passes and the streamer starts and approves the workflow
- **THEN** the exact fork commit deploys and produces a non-secret deployment summary

### Requirement: Patch adoption remains manual
The system SHALL NOT automatically sync or deploy upstream patches. Public instructions SHALL tell the streamer how to review Sync fork, wait for CI, start deployment, approve the environment, and confirm health.

#### Scenario: Maintainer publishes a patch
- **WHEN** the streamer has not accepted the patch
- **THEN** the fork and production Worker remain unchanged
