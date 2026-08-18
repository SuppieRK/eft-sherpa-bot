# MVP Deployment Specification

## Purpose

Define the private Worker deployment, pilot acceptance gate, operator setup, rollback, and quality controls.

## Requirements

### Requirement: One Worker and D1 database per deployment
Each deployment SHALL run as one account-owned Cloudflare Worker with one D1 database. Discord SHALL use HTTP interactions and Twitch SHALL use signed EventSub webhooks. The upstream deployment SHALL use maintainer-owned test resources, and each streamer fork SHALL use streamer-owned production resources.

#### Scenario: A platform command arrives
- **WHEN** Discord or Twitch sends an authenticated command
- **THEN** the configured Worker processes it against its configured D1 database

### Requirement: Private pilot gates streamer setup
The MVP SHALL complete joint internal testing on the developer's private server and hosting before streamer-owned setup. Streamer-owned applications, infrastructure, and public launch SHALL remain separate later work.

#### Scenario: Automated tests pass
- **WHEN** the code has not completed the human private-pilot workflow
- **THEN** the MVP remains incomplete

#### Scenario: Private pilot is accepted
- **WHEN** manual testing is complete and the user accepts the workflow
- **THEN** the internal MVP is complete and ready for archival without starting streamer-owned deployment or public launch

### Requirement: Pilot findings update source artifacts
Accepted private-pilot findings SHALL update the applicable proposal, design, capability specification, implementation tasks, and operator README directly. The change SHALL NOT maintain a separate pilot-feedback ledger.

#### Scenario: Pilot behavior changes
- **WHEN** the user accepts a change discovered during private testing
- **THEN** the relevant source artifacts describe the new behavior without adding or updating a separate feedback file

### Requirement: Streamer setup remains minimal
The technical installer SHALL prepare the streamer-owned applications, infrastructure, GitHub environment, variables, and secrets. The streamer SHALL use browser controls to create the fork and environment, install the Discord application, assign Twitch moderator status, confirm channels and role, sync patches, and approve deployment. The streamer SHALL NOT need a shell or edit a tracked configuration file.

#### Scenario: Streamer-owned setup starts
- **WHEN** the installer prepares the accepted bot for the streamer
- **THEN** public instructions separate the streamer's browser actions from installer-only technical actions

### Requirement: Disposable schema reset
Because the private environment contains no real user data, the operator SHALL recreate its D1 schema from the simplified baseline instead of migrating the discarded experimental schema.

#### Scenario: Simplified release is deployed
- **WHEN** the verified baseline is ready
- **THEN** the operator deletes or recreates only the explicitly identified disposable D1 database, applies the baseline, and deploys the verified Worker

#### Scenario: Baseline storage optimization is deployed
- **WHEN** the trigger-maintained membership count and compatible-raid index are verified locally
- **THEN** the operator replaces the first baseline migration directly, recreates only the disposable private database, and does not create a compatibility migration or run a remote benchmark

#### Scenario: Map capacity validation is deployed
- **WHEN** the map-aware requester-capacity constraint is verified against the complete committed map catalog
- **THEN** the operator revises the first baseline directly and recreates only the explicitly identified disposable private database

### Requirement: Pilot command registration
The private guild SHALL register the shared commands `/request` and `/queue`, the Discord-only association command `/link-twitch`, and the Discord-only staff control `/board`. It SHALL NOT register `/position` or `/spike` as normal user commands.

#### Scenario: Guild commands are listed
- **WHEN** command registration completes
- **THEN** the guild contains the two shared commands, the association command, the staff board control, and neither position nor spike

### Requirement: Worker can deliver Discord messages
The Worker SHALL receive `DISCORD_BOT_TOKEN` as a local, Cloudflare, or GitHub environment secret and SHALL use it only to update configured staff messages and post raid calls to the configured request channel.

#### Scenario: GitHub deploys a configured environment
- **WHEN** the deployment workflow runs after environment approval
- **THEN** the Discord bot token is uploaded to the explicitly configured production Worker with the other Worker secrets and is not written to tracked configuration or deployment evidence

### Requirement: Deployment configures platform integrations idempotently
The production workflow SHALL register the Discord interaction endpoint and commands and SHALL reconcile one matching Twitch EventSub subscription. Repeated deployment SHALL not create duplicate commands or subscriptions.

#### Scenario: Same commit is deployed again
- **WHEN** Discord and Twitch already contain the expected configuration
- **THEN** deployment validates or reuses it without creating duplicates

#### Scenario: Cloudflare secret deployment is still propagating
- **WHEN** the production route returns a transient error after Worker secret upload
- **THEN** deployment waits for bounded Worker readiness before it configures Discord or Twitch

### Requirement: Twitch app token is generated during deployment
GitHub SHALL store the Twitch client secret and SHALL generate, mask, and upload a fresh app access token during deployment. A protected manual workflow SHALL refresh the app token without applying migrations.

#### Scenario: Twitch app token expires
- **WHEN** the operator runs the refresh workflow and approves the production environment
- **THEN** a new token is uploaded and validated without a code or schema change

### Requirement: Deployment has no schedule trigger
The internal Worker SHALL have no Twitch schedule refresh route or Cloudflare cron trigger. The Twitch application token SHALL remain available for chat delivery and authorization health checks.

#### Scenario: Private Worker is deployed
- **WHEN** deployment configuration is rendered
- **THEN** it contains no cron and no schedule-specific credential or setting

### Requirement: Rollback preserves live data by default
Rollback SHALL restore a previous verified Worker version. Deployment SHALL record a D1 Time Travel bookmark, but SHALL NOT automatically restore the database after failure. Applied migrations SHALL remain compatible with the previous Worker version.

#### Scenario: Post-deployment health check fails
- **WHEN** the new Worker does not pass health validation
- **THEN** the operator can restore verified Worker code without automatically discarding D1 writes

### Requirement: Static quality gates block deployment
Repository verification SHALL keep Biome as the sole formatter and baseline linter, run Oxlint with TypeScript 7 type-aware correctness analysis, run Knip for unused project files, exports, types, and dependencies, and reject every warning or finding. The repository SHALL NOT add Gradle or literal Spotless solely for formatting.

#### Scenario: Dead or unsafe code is introduced
- **WHEN** Biome, Oxlint, TypeScript, or Knip reports a configured finding
- **THEN** local verification, pull-request CI, and the deployment workflow fail before Worker deployment

#### Scenario: Static-analysis tooling is deployed
- **WHEN** the zero-finding quality gates and their runtime cleanups pass complete verification
- **THEN** the operator deploys without resetting D1 or re-registering Discord commands
