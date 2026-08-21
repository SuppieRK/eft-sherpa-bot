## ADDED Requirements

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
