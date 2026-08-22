## ADDED Requirements

### Requirement: Open raid hydration is independent of membership history
Planned and active raid reads SHALL select only current membership rows in SQL and SHALL use the partial open-membership index. Terminal raid reads SHALL select only the membership states required by their outcome. Staff mutations SHALL reuse returned state or perform no more than one necessary post-mutation hydration unless an explicit concurrency check requires another read.

#### Scenario: Open raid has extensive removed-member history
- **WHEN** staff review, call, postpone, remove from, record, or reconcile an open raid with many removed memberships
- **THEN** historical memberships are not returned to the Worker and D1 row reads remain bounded by current participants and the requested action

#### Scenario: Completed raid participants are rendered
- **WHEN** staff record a terminal raid result
- **THEN** the result read returns the completed participants required for the message without loading unrelated removed history

#### Scenario: Several reviewed raids are reconciled
- **WHEN** the visible board contains up to ten reviewed or active raids
- **THEN** reconciliation bulk-hydrates the visible raid IDs and candidate summaries instead of repeating unrestricted per-raid history reads

### Requirement: Legacy repair reads only groups demanded by its page
One deployment repair pass SHALL select no more than 80 state-`0` requests. Its compatible-raid lookup SHALL include only priority, game-mode, and map buckets represented by that selected page and SHALL return no more usable partial raids per bucket than the page's demand can consume. Unrelated partial raids SHALL NOT increase the pass's D1 rows returned to the Worker.

#### Scenario: No legacy request exists
- **WHEN** deployment invokes repair with no state-`0` request
- **THEN** repair returns without reading partial raid groups

#### Scenario: Selected page uses few buckets
- **WHEN** 80 selected legacy requests use a subset of the stored priority, mode, and map combinations
- **THEN** repair reads compatible partial raids only for that subset and caps each bucket by its selected demand

#### Scenario: Legacy backlog needs several pages
- **WHEN** more than 80 legacy requests remain
- **THEN** each invocation repairs one bounded page and later calls can continue without one call loading the complete backlog or partial-group population

### Requirement: Canonical board synchronization coalesces and converges
Every committed queue change SHALL increment a monotonic board dirty version. Canonical-board synchronization SHALL use one D1 lease holder to render and PATCH a versioned snapshot, SHALL advance the rendered version only after a successful PATCH, and SHALL use compare-and-set so an older snapshot cannot mark or overwrite a newer version. The lease holder SHALL perform a bounded drain when more changes arrive. Concurrent triggers MAY coalesce into one PATCH.

#### Scenario: Request burst changes the queue
- **WHEN** 10 or 100 request transactions commit while board synchronization overlaps
- **THEN** the board converges to the newest committed dirty version without one complete snapshot and PATCH per request

#### Scenario: Older Discord PATCH finishes later
- **WHEN** an older synchronization attempt completes after a newer dirty version exists
- **THEN** it cannot mark the newer version rendered or leave the canonical board older than the newest successful drain

#### Scenario: Discord PATCH fails
- **WHEN** the lease holder cannot update the canonical board
- **THEN** it does not advance the rendered version and a later drain can retry the dirty work

#### Scenario: Staff select Refresh
- **WHEN** authorized staff select `Refresh`
- **THEN** Refresh uses a current snapshot and current controls through the serialized drain or returns short retry guidance instead of issuing an unordered canonical PATCH

#### Scenario: A current membership position has a gap
- **WHEN** a current member was removed from a non-final position and another compatible request is appended through intake, repair, or postponement
- **THEN** the new member receives a position after the highest current position without colliding with an existing membership

#### Scenario: Board state changes during creation or replacement
- **WHEN** the queue changes after a board snapshot is rendered but before its Discord message ID is stored
- **THEN** only the rendered snapshot version is acknowledged and a later bounded drain renders the newer dirty version

#### Scenario: Several callers create a missing canonical board
- **WHEN** concurrent authorized calls observe no canonical board message
- **THEN** one lease holder stores one canonical message and any losing created message is deleted

#### Scenario: Work remains after one bounded drain
- **WHEN** a newer dirty version still exists after three render attempts
- **THEN** the tracked execution context schedules another bounded drain and final telemetry includes that follow-up

#### Scenario: Manual Refresh is acknowledged
- **WHEN** staff select `Refresh`
- **THEN** the interaction returns a caller-only acknowledgement and only the leased canonical drain writes board content

#### Scenario: Discord board request exceeds its deadline
- **WHEN** a canonical Discord REST request does not finish before the timeout shorter than the board lease
- **THEN** the request is canceled without acknowledging the dirty version as rendered

#### Scenario: Canonical message cannot be recorded
- **WHEN** Discord creates a board message but D1 fails or loses the compare-and-set that records it
- **THEN** the Worker attempts to delete the unrecorded Discord message and leaves board work dirty

### Requirement: Follow-up and legacy candidate work is demand-bounded
One legacy repair pass SHALL fetch at most the candidate count required by its selected 80-request page before candidate hydration. Pull and postpone behavior SHALL preserve requester order and follow-up reuse while its D1 cost is tested against at least 10,000 removed memberships on the relevant raid. A history index or summary structure SHALL be retained only with local evidence that its read reduction justifies its write and storage cost.

#### Scenario: Many compatible raids exceed selected legacy demand
- **WHEN** a selected repair bucket needs two raids and thousands of compatible partial raids exist
- **THEN** candidate hydration returns at most two indexed raids for that bucket

#### Scenario: Removed history is extensive
- **WHEN** staff pull or postpone a requester from a raid with 10,000 removed memberships
- **THEN** the operation preserves the same destination and order semantics and remains within its reviewed operation-family budget
