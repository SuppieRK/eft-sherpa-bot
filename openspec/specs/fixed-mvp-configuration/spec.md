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

### Requirement: Group materialization has no raid cap
The backend SHALL materialize all outstanding requests into stable raid groups subject only to map requester capacity. The staff board SHALL bound only its indexed page query.

#### Scenario: More than ten raids are outstanding
- **WHEN** materialization creates an eleventh raid
- **THEN** it remains durable and appears when it enters the page that contains its service position

### Requirement: Indexed bounded queue operations
Queue lookup SHALL fetch the authenticated caller first and use separate indexed capped-prefix reads for mode-scoped requester position and preceding raids. It SHALL read no more than 101 preceding nonempty same-mode raids with their maintained member totals and 51 preceding raids. The fixed exactness limits of 100 requests ahead and 50 raids ahead SHALL be committed policy, not runtime operator configuration. Compatible-raid lookup SHALL use a trigger-maintained current membership count and a partial mode, map, and stable-order index that excludes full raids. The unified board total SHALL use existing trigger-maintained counters in the existing community singleton. Raid membership reads SHALL use a group-and-position index.

#### Scenario: Queue contains many active requests
- **WHEN** one viewer invokes Queue
- **THEN** the backend does not transfer or draft every active request and its prefix reads remain bounded by the committed limits

#### Scenario: Full compatible raids have accumulated
- **WHEN** materialization searches for an automatically fillable raid on one map
- **THEN** the indexed candidate read excludes full raids instead of scanning them and counting their memberships

### Requirement: Local evidence for performance claims
The repository SHALL provide a reproducible full-Worker benchmark that uses only a fully local seeded D1 database and mocked platform APIs. It SHALL measure the supported successful user-operation families and invalid Twitch request guidance at 100, 1,000, 10,000, and 100,000 active requests, including Discord and Twitch Queue at the 10th, 50th, and 90th percentiles. It SHALL report raw and aggregated wall time, D1 time, statement count, rows read, and rows written in JSON and Markdown.

The repository SHALL commit an exact baseline of statement, row-read, and row-write counts for every deterministic operation and scale. A normal benchmark run SHALL fail on any counter difference and SHALL require an explicit reviewed baseline update for an intentional change. Wall time and D1 duration SHALL remain informational and SHALL NOT gate CI. Concurrent delivery and request-creation bursts SHALL gate correctness and bounded completion without using local wall time as an acceptance limit. Performance claims SHALL cite measured comparison data.

Worker CPU claims SHALL use a credential-free local workerd workload and the Wrangler DevTools profiler. Node.js CPU profiles SHALL NOT be used as evidence for Worker request-path performance.

#### Scenario: Queue performance is evaluated
- **WHEN** an implementation is described as faster or slower
- **THEN** the local benchmark is run for the compared revisions and its report contains both result sets

#### Scenario: Deterministic D1 cost changes
- **WHEN** one operation and scale produces a different statement, row-read, or row-write count from the committed baseline
- **THEN** the normal benchmark fails and identifies the exact counter difference until an operator runs the explicit baseline-update workflow

#### Scenario: Concurrent deliveries are evaluated
- **WHEN** duplicate EventSub deliveries or request submissions overlap under local workerd
- **THEN** correctness assertions verify idempotency, complete grouping, and capacity without enforcing a wall-clock threshold

#### Scenario: Worker CPU optimization is evaluated
- **WHEN** cryptographic verification is changed for performance
- **THEN** deterministic tests verify import reuse and a before-and-after local workerd profile is reviewed without committing credentials or machine-specific profile files

#### Scenario: Benchmark configuration attempts remote D1 access
- **WHEN** the benchmark receives a remote flag, a real D1 identifier, a remote binding, or the pilot Wrangler configuration
- **THEN** it fails before executing any user operation

#### Scenario: Benchmark results vary by host timing
- **WHEN** repeated wall times differ but exact statement and row counters match the committed baseline
- **THEN** the report records the timing distribution without failing a millisecond threshold


### Requirement: Unified bounded display and query policy
All outstanding work SHALL remain durable. The shared board SHALL display ten raids per page. Queue queries SHALL retain capped 100-request and 50-raid exactness thresholds. Page reads SHALL be indexed keyset queries and SHALL NOT use OFFSET scans. Manual placement and resets SHALL reuse existing state and transactions and SHALL NOT renumber the complete list. Deployment SHALL have no raid-attempt policy.

#### Scenario: Backlog grows
- **WHEN** the local benchmark reaches 100,000 requests
- **THEN** query statements and writes remain bounded and page reads do not grow in proportion to page depth
