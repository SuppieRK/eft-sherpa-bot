## MODIFIED Requirements

### Requirement: One Worker and D1 database per deployment
Each deployment SHALL run as one account-owned Cloudflare Worker with one D1 database. Discord SHALL use HTTP interactions and Twitch SHALL use signed EventSub webhooks. The upstream deployment SHALL use maintainer-owned test resources, and each streamer fork SHALL use streamer-owned production resources.

#### Scenario: A platform command arrives
- **WHEN** Discord or Twitch sends an authenticated command
- **THEN** the configured Worker processes it against its configured D1 database

### Requirement: Streamer setup remains minimal
The technical installer SHALL prepare the streamer-owned applications, infrastructure, GitHub environment, variables, and secrets. The streamer SHALL use browser controls to create the fork and environment, install the Discord application, assign Twitch moderator status, confirm channels and role, sync patches, and approve deployment. The streamer SHALL NOT need a shell or edit a tracked configuration file.

#### Scenario: Streamer-owned setup starts
- **WHEN** the installer prepares the accepted bot for the streamer
- **THEN** public instructions separate the streamer's browser actions from installer-only technical actions

### Requirement: Worker can deliver Discord messages
The Worker SHALL receive `DISCORD_BOT_TOKEN` as a local, Cloudflare, or GitHub environment secret and SHALL use it only to update configured staff messages and post raid calls to the configured request channel.

#### Scenario: GitHub deploys a configured environment
- **WHEN** the deployment workflow runs after environment approval
- **THEN** the Discord bot token is uploaded to the explicitly configured production Worker with the other Worker secrets and is not written to tracked configuration or deployment evidence

### Requirement: Rollback preserves live data by default
Rollback SHALL restore a previous verified Worker version. Deployment SHALL record a D1 Time Travel bookmark, but SHALL NOT automatically restore the database after failure. Applied migrations SHALL remain compatible with the previous Worker version.

#### Scenario: Post-deployment health check fails
- **WHEN** the new Worker does not pass health validation
- **THEN** the operator can restore verified Worker code without automatically discarding D1 writes

## ADDED Requirements

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
