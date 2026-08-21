## Context

The Worker receives signed Discord and Twitch webhooks and stores queue state in D1. Twitch currently materializes waiting requests before every recognized command, and valid `!request` materializes again after insertion. Receipt state distinguishes new and repeated deliveries, but the handler does not use that distinction when it schedules external replies. Materialization plans outside the committing batch, so overlapping requests can race on group order, capacity, and positions. Cryptographic verification imports unchanged keys for every delivery.

The fully local workerd benchmark already measures complete Worker paths at four deterministic scales, but it compares only broad limits and cost shape. Oxlint currently enables default correctness plus one typed rule; a full performance dry run finds useful production cases and many intentional sequential loops in tests and operator scripts.

## Goals / Non-Goals

**Goals:**

- Remove redundant Twitch D1 work without changing command responses.
- Make overlapping delivery and request behavior deterministic and capacity-safe.
- Reuse imported cryptographic keys safely within each Worker isolate.
- Add strict reproducible D1 regression evidence and production-focused static checks.
- Produce CPU evidence under workerd rather than Node.js.

**Non-Goals:**

- Change public commands, grouping policy, map limits, or platform permissions.
- Add a D1 migration, dependency, remote benchmark, or production trace sampling.
- Make local wall-clock timing a CI gate.

## Decisions

### Dispatch materialization by command

The common Twitch handler will stop materializing before dispatch. A valid request retains its existing post-create materialization, Queue materializes immediately before its query, and invalid request guidance performs no grouping work. This preserves current queue freshness while removing one request-path D1 call and incidental work from invalid input.

### Resolve materialization races inside the atomic batch

New-group rows will identify their anchor request and insert only while that request is waiting. Expected order-key or action-key conflicts will use conflict-tolerant insertion. Membership insertion will resolve destinations, calculate actual positions from current trigger-maintained counts, rank assignments per destination, and insert only current available capacity. Request state changes only when an open membership exists.

If another invocation wins part of the plan, the method will re-read and replan for at most three passes. A local `no-await-in-loop` suppression documents why these passes must be sequential. Existing D1 compatibility and capacity triggers remain authoritative. This is preferable to a Durable Object or new lock table for the bounded MVP workload.

### Claim each Twitch reply attempt once

The receipt's existing insert result owns the initial pending reply. Pending and sent duplicates do not schedule external work. A failed receipt uses a conditional D1 update from failed to pending, so one overlapping duplicate owns the retry. Canonical-board synchronization runs only for the newly recorded request delivery, not duplicates or reply-only retries. No schema change is needed.

### Cache only the current cryptographic configuration

A small last-value asynchronous cache will retain one import promise for the current source string. Twitch HMAC and Discord Ed25519 verification use separate cache instances. A changed value replaces the entry, and a rejected import clears only its matching entry. This bounds memory, supports configuration rotation in tests and reused isolates, and avoids an unbounded secret-keyed map. Each module reuses one `TextEncoder`.

### Gate exact D1 counters separately from timing and concurrency

A committed baseline file will contain only statements, rows read, and rows written keyed by operation and scale. Normal runs compare every deterministic result exactly; an explicit update option rewrites the baseline after review. Reports are written before mismatch failure so CI can upload evidence. Wall and D1 time remain report-only.

Concurrency tests run complete Worker requests under local workerd and assert final state and external-call counts. Their scheduling-dependent timing is not compared to the deterministic counter baseline.

### Enable Oxlint performance rules where they provide signal

Oxlint will enable explicit correctness and performance categories. It will also name the required promise, loop, spread, and Set rules explicitly, including `typescript/require-await`. `no-await-in-loop` will be disabled for test and benchmark trees and the exact operator scripts whose loops implement pagination, polling, deletion ordering, or retry delay. Useful performance findings and functions that do not need `async` will be rewritten.

### Use generated local profiling credentials

Developer scripts will generate a temporary HMAC secret and Ed25519 key pair under ignored `.artifacts`, create a local-only Wrangler configuration, and replay signed Twitch verification callbacks and Discord ping requests. The base and optimized revisions use the same workload in Wrangler DevTools. Only a short result summary belongs in the pull request; profiles and keys remain local.

## Risks / Trade-offs

- [Concurrent scheduling can vary] → Gate deterministic final state, use bounded replan, and do not compare burst wall time.
- [A cache can retain obsolete key material] → Keep one entry, replace it on value change, and clear rejected imports.
- [Exact D1 baselines require maintenance] → Provide an explicit update command and make every difference visible in review.
- [Performance lint can produce noisy advice] → Scope sequential exceptions narrowly and keep unrelated typed style cleanup out of the change.
- [Local CPU profiles differ by machine] → Use them as before-and-after qualitative evidence and keep deterministic import-count tests as the correctness gate.

## Migration Plan

Implement on the current pull-request branch without a database migration. Generate the pre-cache workerd profile after the profiling harness exists and before the runtime cache change. Run complete verification, the exact local D1 benchmark, and the post-cache profile. Sync and archive the OpenSpec change, push the current branch, and update the existing pull-request description with D1 and CPU evidence. Rollback restores the previous Worker without changing D1.

## Open Questions

None.
