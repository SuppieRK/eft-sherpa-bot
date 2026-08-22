## ADDED Requirements

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

## MODIFIED Requirements

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
