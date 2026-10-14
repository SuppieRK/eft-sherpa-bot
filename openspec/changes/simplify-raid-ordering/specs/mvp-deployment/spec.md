## MODIFIED Requirements

### Requirement: Pull-up performance evidence gates release
Before release, the fully local D1 benchmark SHALL add the private pull-source selector, a maximum bounded pull with successful push-down, and planned-review cancellation to every existing tenfold scale through 100,000 active requests. The seed SHALL include deterministic same-mode and same-map sources, a pinned destination with a compatible source, a legal push target, and a frozen planned review with a canonical details message. The generated report SHALL include latency, D1 rows read, D1 rows written, and statement counts. D1 row statistics SHALL be the primary cost evidence. Statement and write counts SHALL remain constant across scales, and any material row-read or latency growth SHALL block release until reviewed and resolved. The benchmark SHALL NOT contact remote D1 or platform APIs.

#### Scenario: Pull-up benchmark is generated
- **WHEN** performance evidence is prepared for release
- **THEN** every scale measures indexed source selection, the largest standard-map membership movement, and planned-review cancellation using only seeded local D1 and deterministic platform mocks

#### Scenario: Pull-up cost grows with queue size
- **WHEN** D1 statements or writes increase across tenfold scales or rows read and latency show an unexplained material regression
- **THEN** release remains blocked until the query, index, fixture, or implementation is corrected and the report is regenerated

### Requirement: Legacy unassigned repair is deployment-only
The Worker SHALL expose authenticated `POST /internal/repair-unassigned-requests`. One call SHALL repair at most 80 state-`0` requests using stable request arrival ordering, and SHALL return the number repaired plus whether more remain. One call SHALL use fewer than 50 D1 queries for every valid combination of three game modes and thirteen maps. Deployment SHALL repeat the call until none remain, synchronize the canonical board once after the final changed batch, and fail verification if internal status still reports legacy unassigned data. Unauthorized requests SHALL receive the same not-found response as unknown routes.

#### Scenario: No legacy request remains
- **WHEN** deployment calls the protected repair operation with no state-`0` request stored
- **THEN** it returns zero repaired and false for more work without changing the board

#### Scenario: Legacy backlog exceeds one batch
- **WHEN** more than 80 state-`0` requests remain
- **THEN** one call repairs no more than 80 and reports that another call is required

#### Scenario: Maximum valid bucket set is repaired
- **WHEN** one selected page contains requests from all valid game-mode and map buckets
- **THEN** each repair pass selects compatible raid candidates with no more than 20 bounded index-seeking queries and the complete Worker invocation remains below 50 D1 queries

#### Scenario: Final repair batch commits
- **WHEN** the last legacy batch creates one or more assignments
- **THEN** the Worker synchronizes the canonical board and reports that no legacy work remains

#### Scenario: Legacy repair is unauthorized
- **WHEN** a caller omits or supplies the wrong diagnostics bearer token
- **THEN** the Worker returns not found and changes no request, raid, membership, or board

### Requirement: Maintenance cost evidence covers maximum valid dimensions
The fully local Miniflare/workerd D1 benchmark SHALL measure one legacy repair page containing all 39 valid game-mode and map buckets and follow-up cleanup with a large live relationship population. It SHALL record D1 binding calls, statements, rows read, and rows written without a remote D1 database. The maximum-bucket repair SHALL remain below the D1 Free limit of 50 queries per Worker invocation. Follow-up closure cost SHALL remain bounded by the closing source's own relationships rather than all stored relationships.

#### Scenario: Every repair bucket is present
- **WHEN** one repair invocation receives state-`0` requests covering three game modes and all thirteen maps
- **THEN** the repair handles no more than 80 requests and completes with fewer than 50 D1 queries

#### Scenario: Many unrelated follow-ups exist
- **WHEN** a source raid closes while many follow-up relationships belong to other source raids
- **THEN** cleanup does not scan or write those unrelated relationships

## ADDED Requirements

### Requirement: Unified raid migration preserves existing data
Numbered forward migration 0012 SHALL merge existing open priority and ordinary raids in previous priority-first FIFO order into unique normal placement. It SHALL retain raid and request IDs, memberships, leader reservations, capacities, states, outcomes, timestamps, call state, follow-up relationships, statistics, and historical records. Published migrations SHALL remain unchanged. Legacy columns SHALL remain inert and readable for history. Migration and message refresh SHALL NOT call or restart a raid. Operator instructions SHALL require forward repair after migration because a previous split-queue Worker cannot preserve manual placement or shared pages.

#### Scenario: Both old queues contain the same key
- **WHEN** migration runs against populated old queues with overlapping sort keys
- **THEN** every open group remains intact in deterministic unified order without a key collision

#### Scenario: Existing active and terminal raids are migrated
- **WHEN** old records include active calls, postponed leadership, and completed raid history
- **THEN** those records and statistics remain intact and no platform delivery is issued

### Requirement: Unified navigation and placement cost evidence
The local complete-Worker benchmark SHALL cover first, middle, and deep pages, Pin to top, Unpin, whole-raid postponement, no-op, and stale selection at existing scales. Real D1 and Worker tests SHALL cover exact duplicates, retained history, and navigation racing with data updates. Evidence SHALL include binding calls, statements, rows read and written, and query-plan checks without remote D1 or platform access. Reviewed maximum budgets SHALL remain distinct from intentional exact-baseline updates and SHALL NOT be raised for this change.

#### Scenario: A deep page is read
- **WHEN** the streamer navigates a large seeded backlog
- **THEN** indexed page reads remain bounded independently of preceding page count


## ADDED Requirements

### Requirement: Indexed reviewed-move destinations preserve live data
Numbered forward migration 0013 SHALL add the capped eligible-destination service-order index and refresh controls without changing requests, raids, memberships, statistics, leaders, call state, or history. Published migrations SHALL remain unchanged. Complete Worker cost evidence SHALL cover reviewed moves to deep existing destinations and rejected no-destination or stale controls at all existing scales, within unchanged reviewed maximum budgets.

#### Scenario: Existing data receives the destination index
- **WHEN** migration 0013 is applied
- **THEN** all domain records remain intact and board controls refresh without calls

#### Scenario: Eligible destination is deep in the backlog
- **WHEN** a reviewed raid seeks its next destination among 100,000 requests
- **THEN** the indexed lookup reads capped candidates instead of scanning full or reviewed raids
