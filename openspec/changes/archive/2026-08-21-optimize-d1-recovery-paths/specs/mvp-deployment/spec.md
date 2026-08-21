## ADDED Requirements

### Requirement: Foreground maintenance work is bounded
Each Twitch receipt record and Discord mutation claim SHALL delete no more than 250 expired receipt rows before storing the current receipt. Each waiting-request materialization invocation SHALL materialize no more than 250 requests across no more than three contention replans. Waiting selection SHALL reserve at least one candidate for every non-empty queue-kind and game-mode pair within that budget, then use stable queue-kind and request arrival order.

#### Scenario: Expired receipt backlog exists
- **WHEN** a user command arrives with more than 250 expired receipts stored
- **THEN** the invocation deletes only the oldest 250 expired receipts and still claims the current delivery

#### Scenario: Waiting backlog exceeds one batch
- **WHEN** more than 250 requests are waiting for materialization
- **THEN** one invocation assigns no more than 250 and later invocations can drain the remainder

#### Scenario: Waiting backlog contains several modes
- **WHEN** the global batch boundary would otherwise contain requests from fewer modes than the waiting backlog
- **THEN** the selected batch includes the earliest request from every non-empty queue-kind and game-mode pair without changing arrival IDs

#### Scenario: Materialization contends with another invocation
- **WHEN** a pass loses one or more planned assignments and retries
- **THEN** all passes together materialize no more than the invocation's remaining 250-request budget

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

### Requirement: Recovery indexes use additive migration 0005
Migration `0005` SHALL drop `help_requests_queue_order_idx` and SHALL create a partial waiting-request index that supports queue-kind and game-mode head selection by arrival ID. The migration SHALL preserve all request and raid data and SHALL remain compatible with the previous Worker.

#### Scenario: Existing deployment applies migration 0005
- **WHEN** the database already contains migrations `0001` through `0004`
- **THEN** migration `0005` changes only indexes and retains all rows

#### Scenario: Query plans are verified
- **WHEN** local schema tests explain waiting FIFO, waiting pair heads, caller selection, mode-prefix counting, and active duplicate lookup
- **THEN** each query uses its purpose-built index and no production query requires `help_requests_queue_order_idx`

### Requirement: Adversarial D1 evidence gates release
Before release, the fully local Miniflare/workerd D1 benchmark SHALL retain every existing user-facing operation at tenfold active-request scales through 100,000 and SHALL add focused measurements for 1,000 and 10,000 genuinely waiting requests, an expired-receipt backlog larger than one cleanup batch, and open raids with substantial removed-membership history. The report SHALL include statement counts, rows read, rows written, database size, and informational latency without contacting remote D1 or platform APIs.

#### Scenario: Waiting recovery is benchmarked
- **WHEN** the performance report is generated
- **THEN** it measures bounded materialization with 1,000 and 10,000 rows whose request state is waiting and confirms that one invocation assigns no more than 250

#### Scenario: Receipt cleanup is benchmarked
- **WHEN** the performance report is generated with more than 250 expired receipts
- **THEN** it confirms that one foreground claim deletes exactly the bounded batch while accepting the new receipt

#### Scenario: Membership history is benchmarked
- **WHEN** the performance report hydrates an open board raid with substantial removed-member history
- **THEN** removed rows do not increase the membership rows returned to the Worker

#### Scenario: Stored D1 baseline regresses
- **WHEN** a statement, row-read, row-write, or database-size result exceeds its reviewed baseline or absolute contract
- **THEN** release remains blocked until the code, schema, fixture, or documented baseline is corrected
