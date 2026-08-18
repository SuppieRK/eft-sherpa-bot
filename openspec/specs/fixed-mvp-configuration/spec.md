# Fixed MVP Configuration Specification

## Purpose

Define the committed community policy, bounded operations, and local performance-evidence contract.

## Requirements

### Requirement: One deployed community configuration
The MVP SHALL load public Twitch, Discord, infrastructure, and policy values for one community from validated Worker variables rendered from the selected GitHub deployment environment. Credentials SHALL remain in ignored local files, Cloudflare secrets, or GitHub environment secrets. No streamer-specific platform ID SHALL require a tracked fork change.

#### Scenario: Configuration is incomplete
- **WHEN** a live webhook has a missing or malformed deployment value
- **THEN** the operation is blocked before durable state changes and deployment validation reports the invalid variable name

### Requirement: Streamer operation is visual
The streamer SHALL operate requests and raids through Discord commands, the canonical board, and raid-specific messages. The MVP SHALL NOT provide `/setup` or require runtime configuration editing.

#### Scenario: Streamer manages a raid
- **WHEN** the fixed private configuration is deployed
- **THEN** the streamer claims and records raids without opening a deployment tool

### Requirement: Attempt limit is configurable
The fixed MVP policy SHALL load one positive integer attempt limit from deployment configuration and SHALL document three as the production default.

#### Scenario: Third attempt is active under the default
- **WHEN** two unsuccessful attempts have been recorded with the default attempt limit
- **THEN** the raid message removes the unsuccessful outcome and offers only `Helped` and `Postpone raid`

### Requirement: Group materialization has no raid cap
The backend SHALL materialize all outstanding requests into stable queue-specific raid groups subject only to map requester capacity. The staff board SHALL bound only its two display queries.

#### Scenario: More than ten raids are outstanding
- **WHEN** materialization creates an eleventh raid
- **THEN** it remains durable and appears when it enters the fixed window for its queue

### Requirement: Indexed bounded queue operations
Queue lookup SHALL fetch the authenticated caller first and use separate indexed capped-prefix reads for global request position and preceding raids. It SHALL read no more than 101 preceding requests and 51 preceding raids. The fixed exactness limits of 100 requests ahead and 50 raids ahead SHALL be committed policy, not runtime operator configuration. Compatible-raid lookup SHALL use a trigger-maintained current membership count and a partial queue, map, and stable-order index that excludes full raids. The two fixed board totals SHALL use trigger-maintained counters in the existing community singleton. Raid membership reads SHALL use a group-and-position index.

#### Scenario: Queue contains many active requests
- **WHEN** one viewer invokes Queue
- **THEN** the backend does not transfer or draft every active request and its prefix reads remain bounded by the committed limits

#### Scenario: Full compatible raids have accumulated
- **WHEN** materialization searches for an automatically fillable raid on one map
- **THEN** the indexed candidate read excludes full raids instead of scanning them and counting their memberships

### Requirement: Local evidence for performance claims
The repository SHALL provide a reproducible full-Worker benchmark that uses only a fully local seeded D1 database and mocked platform APIs. It SHALL measure the supported successful user-operation families at 100, 1,000, 10,000, and 100,000 active requests, including Discord and Twitch Queue at the 10th, 50th, and 90th percentiles. It SHALL report raw and aggregated wall time, D1 time, statement count, rows read, and rows written in JSON and Markdown. Performance claims SHALL cite measured comparison data.

#### Scenario: Queue performance is evaluated
- **WHEN** an implementation is described as faster or slower
- **THEN** the local benchmark is run for the compared revisions and its report contains both result sets

#### Scenario: Benchmark configuration attempts remote D1 access
- **WHEN** the benchmark receives a remote flag, a real D1 identifier, a remote binding, or the pilot Wrangler configuration
- **THEN** it fails before executing any user operation

#### Scenario: Benchmark results vary by host timing
- **WHEN** repeated wall times differ but statement and row counters retain their allowed cost shape
- **THEN** the report records the timing distribution without failing a millisecond threshold
