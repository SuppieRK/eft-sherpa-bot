## ADDED Requirements

### Requirement: One private Worker and D1 database
The internal MVP SHALL run as one developer-owned Cloudflare Worker with one D1 database. Discord SHALL use HTTP interactions and Twitch SHALL use signed EventSub webhooks.

#### Scenario: A platform command arrives
- **WHEN** Discord or Twitch sends an authenticated command
- **THEN** the one Worker processes it against the one D1 database

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

### Requirement: Streamer setup remains minimal later
After the private pilot is accepted, the later streamer setup SHALL require only Discord installation, Twitch moderator assignment, and confirmation of channels and role. It SHALL NOT require shell or developer-console work from the streamer.

#### Scenario: Later setup starts
- **WHEN** the operator prepares a streamer-owned installation after pilot approval
- **THEN** the streamer receives only the three user-interface actions

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
The Worker SHALL receive `DISCORD_BOT_TOKEN` as a local, Cloudflare, or GitHub secret and SHALL use it only to update the configured staff messages and post raid calls to the configured request channel.

#### Scenario: GitHub deploys the internal test
- **WHEN** the deployment workflow runs with its environment secrets
- **THEN** the Discord bot token is uploaded with the existing Worker secrets and is not written to tracked configuration

### Requirement: Deployment has no schedule trigger
The internal Worker SHALL have no Twitch schedule refresh route or Cloudflare cron trigger. The Twitch application token SHALL remain available for chat delivery and authorization health checks.

#### Scenario: Private Worker is deployed
- **WHEN** deployment configuration is rendered
- **THEN** it contains no cron and no schedule-specific credential or setting

### Requirement: Rollback restores verified code
Rollback SHALL restore the previous verified Worker version. No real-user data recovery promise applies to the disposable internal-test data.

#### Scenario: Private pilot stops
- **WHEN** the test ends or a critical failure occurs
- **THEN** the operator deploys the previous verified Worker version

### Requirement: Static quality gates block deployment
Repository verification SHALL keep Biome as the sole formatter and baseline linter, run Oxlint with TypeScript 7 type-aware correctness analysis, run Knip for unused project files, exports, types, and dependencies, and reject every warning or finding. The repository SHALL NOT add Gradle or literal Spotless solely for formatting.

#### Scenario: Dead or unsafe code is introduced
- **WHEN** Biome, Oxlint, TypeScript, or Knip reports a configured finding
- **THEN** local verification, pull-request CI, and the deployment workflow fail before Worker deployment

#### Scenario: Static-analysis tooling is deployed
- **WHEN** the zero-finding quality gates and their runtime cleanups pass complete verification
- **THEN** the operator deploys without resetting D1 or re-registering Discord commands
