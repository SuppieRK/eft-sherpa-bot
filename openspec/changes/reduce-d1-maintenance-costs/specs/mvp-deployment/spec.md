## MODIFIED Requirements

### Requirement: Foreground maintenance work is bounded
Receipt claims SHALL store duplicate protection without deleting expired rows. After a new Twitch receipt or successful Discord mutation, the Worker SHALL schedule receipt maintenance without delaying the platform response. Maintenance SHALL use a persistent 15-minute D1 lease and the winner SHALL delete no more than the oldest 100 receipts older than 24 hours. User-facing request, queue, and board operations SHALL NOT scan or materialize unrelated state-`0` requests.

#### Scenario: Receipt maintenance is not due
- **WHEN** an authenticated platform interaction arrives before the stored cleanup lease expires
- **THEN** duplicate protection is stored and no expired receipt is deleted

#### Scenario: Expired receipt backlog exists
- **WHEN** receipt maintenance acquires an expired lease with more than 100 expired receipts stored
- **THEN** background work deletes only the oldest 100 receipts and advances the next eligible cleanup time by 15 minutes

#### Scenario: Expired receipt cleanup fails
- **WHEN** background receipt deletion fails after the lease advances
- **THEN** the platform response remains successful and a later interaction can retry after the lease interval

#### Scenario: User-facing operation runs
- **WHEN** a viewer or staff member submits a request, checks the queue, or refreshes the board
- **THEN** the operation performs no unrelated legacy assignment work

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
The Worker SHALL expose authenticated `POST /internal/repair-unassigned-requests`. One call SHALL repair at most 80 state-`0` requests using stable priority, mode-presence, and arrival ordering, and SHALL return the number repaired plus whether more remain. Deployment SHALL repeat the call until none remain, synchronize the canonical board once after the final changed batch, and fail verification if internal status still reports legacy unassigned data. Unauthorized requests SHALL receive the same not-found response as unknown routes.

#### Scenario: No legacy request remains
- **WHEN** deployment calls the protected repair operation with no state-`0` request stored
- **THEN** it returns zero repaired and false for more work without changing the board

#### Scenario: Legacy backlog exceeds one batch
- **WHEN** more than 80 state-`0` requests remain
- **THEN** one call repairs no more than 80 and reports that another call is required

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
- **WHEN** an invalid Twitch request schedules due maintenance with more than 100 expired receipts
- **THEN** the complete Worker path deletes exactly 100 receipts within the reviewed statement, read, and write baseline

#### Scenario: Invalid Twitch input is benchmarked
- **WHEN** an invalid Twitch request arrives without due maintenance
- **THEN** the complete Worker path creates no identity, help request, raid, membership, or Discord board work

#### Scenario: Membership history is benchmarked
- **WHEN** the performance report hydrates an open board raid with substantial removed-member history
- **THEN** removed rows do not increase the membership rows returned to the Worker

#### Scenario: Stored D1 baseline regresses
- **WHEN** a statement, row-read, row-write, database-size, or focused statement-group result exceeds its reviewed baseline or absolute contract
- **THEN** release remains blocked until the code, schema, fixture, or documented baseline is corrected
