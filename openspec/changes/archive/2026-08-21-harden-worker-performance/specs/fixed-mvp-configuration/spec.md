## MODIFIED Requirements

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
