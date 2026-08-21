## 1. Reproducible Worker Profiling

- [x] 1.1 Add credential-free local workerd profile setup and signed Twitch and Discord replay commands that keep generated keys and profiles under `.artifacts`.
- [x] 1.2 Capture and record the pre-cache workerd CPU profile using the profiling workload before changing cryptographic imports.

## 2. Twitch and D1 Hot Paths

- [x] 2.1 Move Twitch materialization from common dispatch into valid request and Queue paths, and add invalid, valid, backlog, and Queue regression coverage.
- [x] 2.2 Make D1 materialization use current state, capacity, and positions inside its atomic batch with conflict-tolerant creation and at most three sequential replans.
- [x] 2.3 Add concurrent request tests for duplicate delivery, one-identity uniqueness, complete grouping, exact membership, no empty raid, and map-capacity enforcement.
- [x] 2.4 Claim initial and failed-retry Twitch reply attempts once, suppress duplicate board synchronization, and test pending, sent, and failed overlapping deliveries.

## 3. Cryptographic Verification and Static Analysis

- [x] 3.1 Add a bounded last-value asynchronous cache with reuse, rotation, rejection-recovery, and concurrent-promise tests.
- [x] 3.2 Reuse one text encoder and cached import promises in Twitch HMAC and Discord Ed25519 verification while retaining signature behavior.
- [x] 3.3 Enable Oxlint correctness and performance categories plus the seven explicit promise, loop, spread, and Set rules; scope sequential-loop exceptions narrowly and resolve their findings.
- [x] 3.4 Capture and record the post-cache workerd CPU profile and compare it with the pre-cache workload without adding a timing gate.

## 4. Exact Local D1 Evidence

- [x] 4.1 Add invalid Twitch request guidance to the user-operation benchmark contract at every existing scale.
- [x] 4.2 Add a complete exact baseline for statements, rows read, and rows written plus an explicit reviewed baseline-update command.
- [x] 4.3 Make ordinary benchmark runs write diagnostic reports, compare every deterministic counter exactly, reject missing or extra baseline entries, and ignore wall-clock variation.
- [x] 4.4 Add unit tests for baseline completeness, mismatch diagnostics, update behavior, and timing exclusion.
- [x] 4.5 Run the fully local benchmark through 100,000 requests, update reviewed counters and reports, and summarize the measured Twitch request-path difference.

## 5. Verification and Delivery

- [x] 5.1 Run formatting, linting, type checking, dead-code checks, migration and documentation checks, deployment-helper tests, all automated tests, build, secret scan, strict OpenSpec validation, and diff checks.
- [x] 5.2 Sync the delta specifications, archive the completed OpenSpec change, commit and push all work to the current branch, and update the existing pull-request description with D1, concurrency, and workerd profile evidence.
