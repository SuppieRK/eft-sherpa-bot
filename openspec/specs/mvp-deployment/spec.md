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
The private guild SHALL register the shared commands `/request` and `/queue`, the Discord-only association command `/link-twitch`, and the Discord-only staff controls `/board`, `/stats`, and `/users`. It SHALL NOT register `/position` or `/spike` as normal user commands.

#### Scenario: Guild commands are listed
- **WHEN** command registration completes
- **THEN** the guild contains the two shared commands, the association command, all three staff controls, and neither position nor spike

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

### Requirement: Game modes use additive migration 0002
Migration `0002` SHALL add non-null compact game-mode fields to help requests and raid groups with PvE as the database default. It SHALL treat every pre-migration help request and raid group as PvE, replace active-request and compatible-raid indexes with mode-aware forms, add an outstanding mode-order index, and install membership compatibility triggers. Migration `0001` SHALL remain unchanged.

#### Scenario: Existing production data is migrated
- **WHEN** migration `0002` is applied to a database containing pre-mode requests and raids
- **THEN** every existing record remains usable as PvE with its prior identity, membership, state, and order

#### Scenario: Old Worker writes during deployment
- **WHEN** migration `0002` is applied before the new Worker begins serving and the previous Worker inserts a request or raid
- **THEN** the database assigns PvE by default and the record remains valid for the new Worker

#### Scenario: Mode-aware uniqueness is enforced
- **WHEN** migration `0002` has completed
- **THEN** D1 permits the same viewer and map in different modes but rejects a duplicate active request for the same viewer, mode, and map

### Requirement: Mixed-mode performance evidence gates release
Before release, the local D1 benchmark SHALL seed a deterministic mix of PvP Seasonal, PvP, and PvE records at the existing tenfold sizes through 100,000 requests. It SHALL exercise every existing user-facing benchmark operation with mode-aware data and SHALL produce an updated report containing latency, D1 rows read, and D1 rows written for each operation and size without contacting a remote D1 database. D1 row statistics SHALL be the primary cost evidence. Release SHALL NOT proceed until the report exists and any material regression from the previous report has been reviewed and explained.

#### Scenario: Mode-aware benchmark is run
- **WHEN** performance evidence is prepared for this change
- **THEN** the benchmark uses only seeded local D1 data, includes all three modes, retains comparable 10x size points through 100,000 requests, and reports latency plus D1 rows read and written for every user-facing operation and size

#### Scenario: Pre-release benchmark evidence is missing
- **WHEN** the accepted release commit does not have a complete updated mixed-mode benchmark report or an unexplained material regression remains
- **THEN** release is blocked until the evidence is produced and reviewed

### Requirement: Rollback preserves live data by default
Rollback SHALL restore a previous verified Worker version when that version can preserve the active schema semantics. Deployment SHALL record a D1 Time Travel bookmark, but SHALL NOT automatically restore the database after failure. Additive migration `0002` SHALL remain structurally usable by the previous Worker during the migration-to-deployment interval because new game-mode fields default to PvE. After the new Worker accepts a PvP Seasonal or PvP request, recovery SHALL prefer a forward repair because a pre-mode Worker cannot preserve mode-safe grouping.

#### Scenario: Health check fails before a non-PvE request exists
- **WHEN** the new Worker does not pass health validation before it accepts a PvP Seasonal or PvP request
- **THEN** the operator can restore verified Worker code without automatically discarding D1 writes

#### Scenario: Failure occurs after non-PvE data exists
- **WHEN** the deployed Worker has accepted PvP Seasonal or PvP data and then fails validation
- **THEN** the operator repairs or redeploys mode-aware code instead of restoring behavior that can mix game modes

### Requirement: Static quality gates block deployment
Repository verification SHALL keep Biome as the sole formatter and baseline linter, run Oxlint with TypeScript 7 type-aware correctness and performance analysis for production code, run Knip for unused project files, exports, types, and dependencies, and reject every warning or finding. Oxlint SHALL explicitly enforce `typescript/no-misused-promises`, `typescript/require-await`, `no-await-in-loop`, `oxc/no-accumulating-spread`, `unicorn/prefer-set-has`, `unicorn/prefer-set-size`, and `unicorn/no-useless-spread`. Required sequential test, benchmark, authorization-polling, pagination, and deployment-retry loops SHALL use narrow rule overrides, while an intentional bounded production retry SHALL use a local documented suppression. The repository SHALL NOT add Gradle or literal Spotless solely for formatting.

#### Scenario: Dead or unsafe code is introduced
- **WHEN** Biome, Oxlint, TypeScript, or Knip reports a configured finding
- **THEN** local verification, pull-request CI, and the deployment workflow fail before Worker deployment

#### Scenario: Sequential work is required
- **WHEN** a loop must preserve fixture order, API pagination, authorization polling, retry delay, or a bounded materialization replan
- **THEN** the exception is scoped to that code instead of disabling production performance analysis globally

#### Scenario: Static-analysis tooling is deployed
- **WHEN** the zero-finding quality gates and their runtime cleanups pass complete verification
- **THEN** the operator deploys without resetting D1 or re-registering Discord commands

### Requirement: Requester pull-up uses additive migration 0003
Migration `0003` SHALL add a partial raid-group index ordered by queue kind, game mode, map, and stable raid order for planned, automatically fillable, unreserved raids. It SHALL support full and partial pull-source discovery and bounded push-target lookup without changing a stored row or removing an existing index. The migration SHALL remain structurally compatible with the previous Worker, which ignores the additional index.

#### Scenario: Pull source can be full
- **WHEN** local schema verification explains the planned source query for a full same-mode and same-map raid
- **THEN** SQLite seeks through the migration `0003` index instead of scanning `raid_groups` or creating a temporary order sort

#### Scenario: Previous Worker is restored
- **WHEN** the new Worker fails validation after migration `0003` is applied
- **THEN** the operator may restore the previous verified Worker without reverting the unused index or changing live request data

### Requirement: Pull-up performance evidence gates release
Before release, the fully local D1 benchmark SHALL add the private pull-source selector, a maximum bounded pull with successful push-down, and planned-review cancellation to every existing tenfold scale through 100,000 active requests. The seed SHALL include deterministic same-mode and same-map sources, a Priority destination with an Ordinary source, a legal push target, and a frozen planned review with a canonical details message. The generated report SHALL include latency, D1 rows read, D1 rows written, and statement counts. D1 row statistics SHALL be the primary cost evidence. Statement and write counts SHALL remain constant across scales, and any material row-read or latency growth SHALL block release until reviewed and resolved. The benchmark SHALL NOT contact remote D1 or platform APIs.

#### Scenario: Pull-up benchmark is generated
- **WHEN** performance evidence is prepared for release
- **THEN** every scale measures indexed source selection, the largest standard-map membership movement, and planned-review cancellation using only seeded local D1 and deterministic platform mocks

#### Scenario: Pull-up cost grows with queue size
- **WHEN** D1 statements or writes increase across tenfold scales or rows read and latency show an unexplained material regression
- **THEN** release remains blocked until the query, index, fixture, or implementation is corrected and the report is regenerated

### Requirement: Staff statistics performance evidence gates release
Before release, the fully local D1 benchmark SHALL measure `/stats` at every existing tenfold scale from 100 through 100,000 active and historical requests. The deterministic seed SHALL include open, helped, and canceled requests; successful and not-run raids; completed and removed memberships; the streamer; more than ten volunteer leaders; and ranking ties. The generated report SHALL include latency, D1 rows read, D1 rows written, and statement counts. Statements and median rows read SHALL remain constant across scales, and `/stats` SHALL write zero rows. The same benchmark SHALL measure representative request and raid-result mutations. Their statements and writes SHALL remain constant, and their median indexed reads SHALL grow by no more than 32 rows across all benchmark scales. Any unexplained growth SHALL block release until reviewed and resolved. The benchmark SHALL NOT contact remote D1 or platform APIs.

#### Scenario: Staff statistics benchmark is generated
- **WHEN** performance evidence is prepared for release
- **THEN** every scale measures the complete `/stats` repository and rendering path against seeded local D1 and deterministic Discord input

#### Scenario: Statistics query has unstable cost
- **WHEN** statement count or median rows read changes by scale, a D1 row is written, or latency growth is unexplained
- **THEN** release remains blocked until the query, rollup, schema, fixture, or implementation is corrected and the report is regenerated

#### Scenario: Rollup maintenance cost grows with history
- **WHEN** a representative request or raid-result mutation changes its statement or write count or gains more than 32 median row reads across the benchmark scales
- **THEN** release remains blocked until the trigger, index, fixture, or mutation is corrected and the report is regenerated

### Requirement: Statistics rollup migration is additive and forward repaired
Migration `0004` SHALL create and backfill the singleton statistics summary and per-leader statistics rows before it installs transactional maintenance triggers. The migration SHALL preserve all authoritative request, membership, and raid history. After the migration is applied, a rollup defect SHALL be corrected with a forward migration rather than by rolling back to a Worker that reads absent rollup tables.

#### Scenario: Existing history is migrated
- **WHEN** migration `0004` is applied to a database with retained help history
- **THEN** the initial rollup result equals a direct aggregation of that history

#### Scenario: A deployed rollup needs correction
- **WHEN** a defect is found after migration `0004` was applied
- **THEN** deployment preserves authoritative history and uses a forward repair migration

### Requirement: Staff user-directory performance evidence gates release
Before release, the fully local D1 benchmark SHALL measure the first, middle, and last `/users` keyset pages and one missing-Discord completion at every existing tenfold scale from 100 through 100,000 user mappings. The deterministic seed SHALL mix observed and unobserved Twitch IDs, linked and unlinked Discord users, and present and missing Escape from Tarkov names. The generated report SHALL include latency, D1 rows read, D1 rows written, and statement counts. Page statements and row reads SHALL remain constant across scales and page reads SHALL write zero rows. Completion statements and writes SHALL remain bounded and constant across scales. The benchmark SHALL NOT contact remote D1 or platform APIs.

#### Scenario: User-directory benchmark is generated
- **WHEN** performance evidence is prepared for release
- **THEN** every scale measures first, middle, and last keyset navigation and one missing-Discord completion using only seeded local D1 and deterministic Discord interactions

#### Scenario: User pagination scans preceding pages
- **WHEN** a later-page query has row reads or latency that grow with the number of preceding users
- **THEN** release remains blocked until keyset ordering or index use is corrected and the report is regenerated

#### Scenario: Missing-detail completion cost grows with directory size
- **WHEN** the completion path's statements, writes, row reads, or latency grow with the number of unrelated mappings
- **THEN** release remains blocked until identity lookup, uniqueness enforcement, or mutation logic is corrected and the report is regenerated

### Requirement: Foreground maintenance work is bounded
Receipt claims SHALL store duplicate protection without deleting expired rows. After a new Twitch receipt or successful Discord mutation, the Worker SHALL schedule receipt maintenance without delaying the platform response. Maintenance SHALL use a persistent 15-minute D1 lease and the winner SHALL delete no more than the oldest 100 receipts older than 24 hours. User-facing request, queue, and board operations SHALL NOT scan or materialize unrelated state-`0` requests.

#### Scenario: Receipt maintenance is not due
- **WHEN** an authenticated platform interaction arrives before the stored cleanup lease expires
- **THEN** duplicate protection is stored and no expired receipt is deleted

#### Scenario: Expired receipt backlog exists
- **WHEN** receipt maintenance acquires an expired lease with more than 100 expired receipts stored
- **THEN** background work deletes only the oldest 100 expired receipts and advances the next eligible cleanup time by 15 minutes

#### Scenario: Expired receipt cleanup fails
- **WHEN** background receipt deletion fails after the lease advances
- **THEN** the platform response remains successful and a later interaction can retry after the lease interval

#### Scenario: User-facing operation runs
- **WHEN** a viewer or staff member submits a request, checks the queue, or refreshes the board
- **THEN** the operation performs no unrelated legacy assignment work

### Requirement: Identity observation avoids unchanged writes
The D1 repository SHALL preserve identity conflict resolution and field precedence while avoiding a user-mapping update when all effective stored values are unchanged. Twitch-only observation SHALL complete without reading the stored mapping back to the Worker.

#### Scenario: Known Twitch identity is observed again
- **WHEN** the same normalized Twitch login and Twitch platform ID are observed with no other field change
- **THEN** D1 performs no user-mapping row update and returns no mapping payload

#### Scenario: Twitch platform ID changes
- **WHEN** an observed Twitch platform ID is currently assigned to another normalized login
- **THEN** the repository clears the conflicting assignment and stores the ID on the current login

#### Scenario: Discord supplies improved identity details
- **WHEN** request or link processing supplies a changed Discord identity, display name, or permitted in-game name
- **THEN** the generic mapping workflow persists the effective changed values and returns the resulting mapping

### Requirement: Open board reads exclude membership history
The D1 board snapshot SHALL join only current memberships for planned and active raids. Historical single-raid reads SHALL retain the membership states required to return participants for completed raid results.

#### Scenario: Open raid has removed membership history
- **WHEN** the board hydrates a planned or active raid that has current and removed membership rows
- **THEN** D1 returns only current memberships to board rendering

#### Scenario: Helped raid is read after completion
- **WHEN** result handling reads a completed helped raid
- **THEN** the returned raid still contains its completed participants

### Requirement: Recovery support uses additive migration 0005
Migration `0005` SHALL retain state `0`, its bounded repair indexes, and the waiting-to-planned membership transition for previous-Worker compatibility. It SHALL add the receipt-maintenance lease and optimized capacity and statistics triggers without rebuilding `help_requests`. New Worker intake SHALL explicitly insert state `1` and SHALL NOT persist state `0` during normal operation.

#### Scenario: Existing deployment applies migration 0005
- **WHEN** the database already contains migrations `0001` through `0004`
- **THEN** migration `0005` retains every request, raid, membership, and statistic while installing compatible indexes, lease state, and triggers

#### Scenario: Previous Worker writes after migration
- **WHEN** the previous Worker inserts a state-`0` request, adds its membership, and performs its explicit request-state update
- **THEN** migration `0005` plans the request safely and the repeated update is a no-op

#### Scenario: Previous Worker is restored
- **WHEN** a rollback deploys the previous Worker after new atomic requests were accepted
- **THEN** that Worker can read and operate on the existing numeric states, raids, and memberships

### Requirement: Legacy unassigned repair is deployment-only
The Worker SHALL expose authenticated `POST /internal/repair-unassigned-requests`. One call SHALL repair at most 80 state-`0` requests using stable priority, mode-presence, and arrival ordering, and SHALL return the number repaired plus whether more remain. One call SHALL use fewer than 50 D1 queries for every valid combination of two queue kinds, three game modes, and thirteen maps. Deployment SHALL repeat the call until none remain, synchronize the canonical board once after the final changed batch, and fail verification if internal status still reports legacy unassigned data. Unauthorized requests SHALL receive the same not-found response as unknown routes.

#### Scenario: No legacy request remains
- **WHEN** deployment calls the protected repair operation with no state-`0` request stored
- **THEN** it returns zero repaired and false for more work without changing the board

#### Scenario: Legacy backlog exceeds one batch
- **WHEN** more than 80 state-`0` requests remain
- **THEN** one call repairs no more than 80 and reports that another call is required

#### Scenario: Maximum valid bucket set is repaired
- **WHEN** one selected page contains requests from all valid priority, game-mode, and map buckets
- **THEN** each repair pass selects compatible raid candidates with no more than 20 bounded index-seeking queries and the complete Worker invocation remains below 50 D1 queries

#### Scenario: Final repair batch commits
- **WHEN** the last legacy batch creates one or more assignments
- **THEN** the Worker synchronizes the canonical board and reports that no legacy work remains

#### Scenario: Legacy repair is unauthorized
- **WHEN** a caller omits or supplies the wrong diagnostics bearer token
- **THEN** the Worker returns not found and changes no request, raid, membership, or board

### Requirement: User-facing D1 evidence gates release
Before release, the fully local Miniflare/workerd D1 benchmark SHALL retain every user-facing operation at tenfold active-request scales through 100,000. It SHALL remove waiting-backlog board Refresh from the user-operation contract and SHALL measure atomic request creation, leased expired-receipt cleanup, and open raids with substantial removed-member history. The report SHALL include statements, rows read, rows written, database size, informational latency, and focused statement groups without contacting remote D1 or platform APIs. Production telemetry SHALL retain totals-only D1 instrumentation.

#### Scenario: Atomic request creation is benchmarked
- **WHEN** Discord or Twitch accepts a new request
- **THEN** the complete Worker path returns with one planned request and one open membership and does not exceed the reviewed statement, read, or write baseline

#### Scenario: Queue and board operations are benchmarked
- **WHEN** Discord or Twitch checks a queue or staff refresh the board
- **THEN** the complete Worker path contains no materialization statement and performs no assignment write

#### Scenario: Receipt cleanup is benchmarked
- **WHEN** a valid Twitch queue command schedules due maintenance with more than 100 expired receipts
- **THEN** the complete Worker path deletes exactly 100 receipts within the reviewed statement, read, and write baseline

#### Scenario: Invalid Twitch input is benchmarked
- **WHEN** an invalid Twitch request arrives with or without due receipt maintenance
- **THEN** the complete Worker path performs no D1 statement and creates no identity, receipt, help request, raid, membership, or Discord board work

#### Scenario: Membership history is benchmarked
- **WHEN** the performance report hydrates an open board raid with substantial removed-member history
- **THEN** removed rows do not increase the membership rows returned to the Worker

#### Scenario: Stored D1 baseline regresses
- **WHEN** a statement, row-read, row-write, database-size, or focused statement-group result exceeds its reviewed baseline or absolute contract
- **THEN** release remains blocked until the code, schema, fixture, or documented baseline is corrected

### Requirement: Runtime D1 telemetry covers foreground and background work
Production telemetry SHALL emit one foreground usage event, one completion or failure event for each named `waitUntil()` task, and one correlated final aggregate after all tracked tasks settle. Every event SHALL report D1 binding calls, statements, rows read, rows written, D1 duration, wall time, and outcome from an independent metric scope. A D1 batch SHALL count as one binding call while retaining its per-statement result totals. Telemetry SHALL identify repository queries with stable explicit query IDs and SHALL NOT contain command text, user identity, secrets, or request data. Cloudflare D1 Analytics SHALL remain the authoritative billed total.

#### Scenario: Twitch reply completes in the background
- **WHEN** the Worker returns its EventSub response before reply-status storage and board synchronization finish
- **THEN** foreground telemetry excludes that later work, each background task reports its own D1 usage, and the final correlated event includes both scopes

#### Scenario: Background task fails
- **WHEN** receipt cleanup or Discord board reconciliation rejects
- **THEN** its background event records a safe failure code and its D1 usage without changing the successful foreground response

#### Scenario: A D1 batch executes several statements
- **WHEN** one binding batch returns several statement results
- **THEN** telemetry counts one binding call and records every returned statement's rows and duration under stable query IDs

#### Scenario: Production cost is reviewed
- **WHEN** an operator evaluates billed D1 use
- **THEN** the operator compares custom per-operation evidence with Cloudflare D1 Analytics for the same deployment and time window and treats D1 Analytics as authoritative

### Requirement: Routine internal status has bounded D1 cost
`GET /internal/status` SHALL report only bounded schema readiness, whether legacy unassigned requests exist, and any request total obtained from the singleton statistics rollup. It SHALL NOT count the complete help-request or receipt tables. Deployment readiness and verification SHALL use this routine endpoint without an unbounded receipt diagnostic.

#### Scenario: Historical tables are large
- **WHEN** internal status runs with many terminal requests or retained receipts
- **THEN** its statements and D1 rows read remain bounded independently of those table sizes

#### Scenario: Statistics rollup is available
- **WHEN** internal status includes a submitted-request total
- **THEN** it reads `staff_statistics_summary.submitted_requests` instead of counting `help_requests`

### Requirement: Runtime hardening uses additive migration 0006
Migration `0006` SHALL preserve migrations `0001` through `0005`, add stable-Twitch-ID active-request uniqueness, deterministically reconcile any pre-existing active duplicates, and add canonical-board dirty-version, rendered-version, and lease state. It SHALL remain readable by the previous Worker. It SHALL drop `raid_groups_outstanding_idx` only if fully local query-plan and benchmark evidence proves that no production query needs it.

#### Scenario: Stable identity duplicates exist before migration
- **WHEN** several active requests share stable Twitch user ID, game mode, and map under different logins
- **THEN** migration `0006` retains the oldest request, cancels later duplicates, removes their open memberships, and permits the new unique index to be created

#### Scenario: No duplicate needs repair
- **WHEN** migration `0006` runs on valid existing data
- **THEN** it retains every request, membership, raid, statistic, and receipt while adding the new index and board state

#### Scenario: Previous Worker is restored
- **WHEN** deployment rolls Worker code back after migration `0006`
- **THEN** the previous Worker can ignore additive board state and continue to read the existing request and raid schema

#### Scenario: Redundant index is not proven redundant
- **WHEN** any local production-query plan or benchmark needs `raid_groups_outstanding_idx` or shows a material regression without it
- **THEN** migration `0006` retains that index

### Requirement: Expanded local D1 evidence gates release
Before release, the fully local Miniflare/workerd D1 benchmark SHALL retain user-facing operations at 100, 1,000, 10,000, and 100,000 active requests and SHALL add operator status, exact duplicate delivery, legacy repair, retained-history, raid-action, reviewed-raid reconciliation, and board-burst suites. It SHALL report exact binding calls, statements, rows read, rows written, database size, stable query IDs, and informational latency without contacting remote D1 or platform APIs. It SHALL use Node 26 and report a digest of benchmark source, migrations, fixtures, and configuration. A hand-reviewed maximum-budget file SHALL be separate from the rewritable exact baseline, and the baseline update command SHALL NOT change maximum budgets. Production deployment verification SHALL run `npm run benchmark:d1` before migration or deployment.

#### Scenario: Exact delivery replay is benchmarked
- **WHEN** Discord or Twitch sends the same delivery ID and body more than once
- **THEN** the report distinguishes the first delivery from the exact replay and verifies that repeated command-side D1 work does not occur

#### Scenario: Routine status is benchmarked
- **WHEN** request and receipt history grows while the active shape is fixed
- **THEN** the operator-cost report shows bounded statements, binding calls, and rows read for `/internal/status`

#### Scenario: Legacy repair is benchmarked
- **WHEN** fixtures contain zero legacy requests, one 80-request page, several pages, or many unrelated partial raids
- **THEN** the maintenance report demonstrates page and bucket bounds independently of total stored partial raids

#### Scenario: Membership history grows
- **WHEN** a fixed active population is combined with 10,000 or 100,000 terminal requests, closed raids, removed memberships, or retained receipts
- **THEN** call, result, postpone, remove, and reconciliation paths remain within their reviewed budgets

#### Scenario: Board work overlaps
- **WHEN** ten reviewed raids are reconciled or 10 to 100 request creations overlap
- **THEN** the report measures coalesced snapshots and PATCH scheduling and proves that the final board version is current

#### Scenario: Maximum budget is exceeded
- **WHEN** binding calls, statements, rows, writes, or database size exceed a hand-reviewed maximum
- **THEN** release remains blocked and updating the exact baseline cannot approve the regression

#### Scenario: Benchmark provenance is stale
- **WHEN** the runtime is not Node 26 or the recorded source digest does not match benchmark inputs
- **THEN** the report is not accepted as current evidence

#### Scenario: Deployment verification starts
- **WHEN** GitHub Actions prepares to migrate or deploy the production Worker
- **THEN** it runs the local D1 benchmark contract and stops before external changes if the contract fails

### Requirement: Local benchmark evidence measures the current Worker and failed calls
The benchmark digest SHALL include production source, lockfiles, runtime pins, migrations, benchmark configuration, and the exact baseline. Instrumentation SHALL count every attempted D1 binding call before awaiting it, including rejected standalone calls. Maximum budgets SHALL be reviewed per operation family. Semantic guards SHALL use stable query IDs and SHALL fail when the query class they claim to protect was not captured. CI SHALL upload only evidence generated by a successful benchmark in the current run.

#### Scenario: Standalone D1 call rejects
- **WHEN** a prepared-statement binding rejects before returning result metadata
- **THEN** telemetry records one binding attempt and no successful statement result

#### Scenario: Assignment guard captures no assignment work
- **WHEN** the benchmark completes without any stable `assignment.*` query ID
- **THEN** the benchmark contract fails instead of reporting an inactive guard as passing

#### Scenario: One operation family exceeds its reviewed maximum
- **WHEN** that family's binding, statement, row, write, or size cost exceeds its approved limit
- **THEN** the benchmark fails even if the cost remains below another family's limit

### Requirement: Production telemetry includes named background work
The Worker SHALL route every named background task through the tracked execution context when telemetry is active. Final request telemetry SHALL include the task's D1 statements, rows read, rows written, binding calls, outcome, and elapsed time after the task settles. A plain Cloudflare execution context SHALL continue to schedule the same task through `waitUntil()`.

#### Scenario: Staff action schedules background D1 work
- **WHEN** a Discord staff action schedules board, reconciliation, receipt, or raid-call status work through the telemetry-wrapped execution context
- **THEN** production telemetry emits the named background task and includes its database usage in the final invocation totals

#### Scenario: Telemetry wrapper is absent
- **WHEN** the same staff task receives a plain Cloudflare execution context
- **THEN** the Worker schedules it with `waitUntil()` and does not require a telemetry-only context member

### Requirement: Maintenance cost evidence covers maximum valid dimensions
The fully local Miniflare/workerd D1 benchmark SHALL measure one legacy repair page containing all 78 valid priority, game-mode, and map buckets and follow-up cleanup with a large live relationship population. It SHALL record D1 binding calls, statements, rows read, and rows written without a remote D1 database. The maximum-bucket repair SHALL remain below the D1 Free limit of 50 queries per Worker invocation. Follow-up closure cost SHALL remain bounded by the closing source's own relationships rather than all stored relationships.

#### Scenario: Every repair bucket is present
- **WHEN** one repair invocation receives state-`0` requests covering two queue kinds, three game modes, and all thirteen maps
- **THEN** the repair handles no more than 80 requests and completes with fewer than 50 D1 queries

#### Scenario: Many unrelated follow-ups exist
- **WHEN** a source raid closes while many follow-up relationships belong to other source raids
- **THEN** cleanup does not scan or write those unrelated relationships
