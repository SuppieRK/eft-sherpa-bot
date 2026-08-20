# staff-statistics Specification

## Purpose
TBD - created by archiving change add-staff-stats-command. Update Purpose after archive.
## Requirements
### Requirement: Staff statistics report all-time request outcomes
The system SHALL calculate statistics from all retained help requests. It SHALL report submitted requests as every unique stored help request, helped requests as requests in completed state, open requests as requests in waiting or planned state, and canceled requests as requests in canceled state. It SHALL report successful raids as completed raid groups with the Helped outcome. It SHALL NOT describe canceled requests as no-shows because the stored state does not distinguish cancellation reasons.

#### Scenario: Historical and current requests exist
- **WHEN** authorized staff invoke `/stats`
- **THEN** the response lists all retained submitted, helped, open, and canceled request counts and the successful raid count

#### Scenario: A request was postponed before completion
- **WHEN** a request has removed historical memberships and one completed membership in its successful final raid
- **THEN** the request counts once as helped and is attributed only through the completed membership

#### Scenario: No work has been recorded
- **WHEN** the database contains no help requests or raid groups
- **THEN** every summary count is zero and the response states that no sherpa has completed a request

### Requirement: Successful requests are attributed to their raid leader
The system SHALL attribute each helped request to the Discord leader of the successful raid containing its completed membership. It SHALL rank leaders by helped-request count descending, then successful-raid count descending, then stable Discord user ID. Each row SHALL show the leader, helped-request count, and successful-raid count in parentheses. The configured streamer and volunteer sherpas SHALL use the same attribution rule. The system SHALL NOT count removed memberships, canceled raids, planned raids, active raids, or unsuccessful attempts as helped work.

#### Scenario: One raid helps several requesters
- **WHEN** one successful raid completes three current request memberships
- **THEN** its leader receives credit for three helped requests and one successful raid

#### Scenario: Leaders have equal helped-request counts
- **WHEN** two leaders have helped the same number of requests
- **THEN** the leader with more successful raids appears first and any remaining tie uses stable Discord user ID order

#### Scenario: A raid did not complete successfully
- **WHEN** a raid is planned, active, canceled, or has the Not Run outcome
- **THEN** it contributes no helped request or successful raid credit

### Requirement: Stats use one caller-only list embed
`/stats` SHALL operate only in the configured staff channel and return one ephemeral Discord message visible only to the caller. The message SHALL contain one embed with an all-time heading, a list of request and successful-raid totals, and a ranked sherpa list. It SHALL contain no component, Delete control, Refresh control, persistent message identity, board link, or requester mention. Leader mentions SHALL render without sending a notification.

The sherpa list SHALL show at most ten leaders. When more leaders have successful work, it SHALL state how many additional leaders are omitted. The complete embed SHALL stay within Discord field, item, and 6,000-character aggregate limits.

#### Scenario: Staff member requests statistics
- **WHEN** an authorized staff member invokes `/stats` in the configured staff channel
- **THEN** Discord returns one ephemeral list-based embed with no components and no notification mention

#### Scenario: Staff member requests statistics outside the staff channel
- **WHEN** an authorized staff member invokes `/stats` outside the configured staff channel
- **THEN** Discord returns only a short ephemeral denial and reveals no statistics

#### Scenario: More than ten leaders have helped requests
- **WHEN** the attribution query returns more than ten credited leaders
- **THEN** the embed lists the first ten in ranked order and states the number of additional leaders

#### Scenario: Statistics change after the response
- **WHEN** request or raid state changes after a statistics embed was returned
- **THEN** the existing ephemeral snapshot is not refreshed or tracked and a later `/stats` invocation calculates a new snapshot

### Requirement: Statistics use transactionally maintained rollups
The system SHALL backfill statistics rollups from authoritative help-request, completed-membership, and raid-group state. It SHALL maintain the rollups in the same D1 transaction as each supported source insert, update, deletion, leader reassignment, or membership transfer. Source tables SHALL remain authoritative, and the rollups SHALL produce the same result as direct source aggregation after each supported transition.

The statistics calculation SHALL read one summary row and at most ten ranked leader rows with a constant bounded number of D1 statements. Its statement count and rows read SHALL remain independent of retained history, and it SHALL write no D1 row. The system SHALL NOT use a scheduled rollup, contact a platform API, or use a remote database benchmark.

#### Scenario: Statistics are requested repeatedly
- **WHEN** authorized staff invoke `/stats` several times without another state transition
- **THEN** each invocation returns the same calculated values without changing a request, raid, membership, receipt, or statistics row

#### Scenario: Retained history reaches the largest benchmark scale
- **WHEN** authorized staff invoke `/stats` with 100,000 retained requests
- **THEN** the command reads only the singleton summary and at most ten ranked leader rows

#### Scenario: Authoritative state is corrected
- **WHEN** a request, completed membership, successful raid, or successful raid leader is inserted, changed, transferred, or deleted
- **THEN** the transaction leaves the rollups equal to a direct aggregation of the resulting source state

#### Scenario: A leader changes their Discord display name
- **WHEN** Discord renders a stored leader user ID after that user changes their display name
- **THEN** the current Discord mention provides the readable name without a stored volunteer profile or API lookup
