## Context

The bot uses one Worker and D1. The audit reproduced three stale-read races, exhausted integer ordering gaps, closed follow-up read growth, and oversized output. Public Discord attachment also needs a staff-only replacement rule.

## Goals / Non-Goals

Goals: preserve valid request membership under concurrent actions; bound normal costs; retain complete Discord goals and notes; protect existing Discord links.

Non-goals: multiple EFT profiles, outboxes, new commands, remote testing, deployment, and unrelated refactoring.

## Decisions

- Test at the user-confirmed Worker, public repository, and local D1 seams. Use a D1 binding barrier for deterministic races, not repository-method mocks. Follow one failing test with one fix.
- Validate state inside each D1 batch. A stale action must roll back, not throw after partial writes commit. Prefer small conditional SQL guards to a new workflow table.
- Retain sparse ordering. Handle exhausted gaps only on the exceptional path. Find the adjacent occupied integer keys, then move only that block into the next gap. Use a checked temporary range above the maximum live key to avoid unique-index collisions. Do not rewrite the queue tail. Test repeated pull/postpone cycles and unchanged distant raid keys.
- Measure closed-target history, then remove obsolete follow-up relations with indexed cleanup if its measured write cost is acceptable. Do not scan all unrelated relations on closure.
- Bound Twitch output with a count of omitted additional requests. Split Discord fields when needed; do not truncate goals or notes.
- Pass trusted staff authority into identity mutations. Validate target Discord ownership before conflict-clearing writes, in the same transaction.

## Risks / Trade-offs

- Read-only SQL assertions abort stale batches before mutations. Convert their database errors to a short review-again response. Guards add one statement and up to three reads to affected operations; local benchmarks validate the cost without increasing maximum budgets.
- Follow-up cleanup adds one index. The seeded databases grow by 4 KiB, and normal follow-up creation adds one measured write. With 10,000 closed follow-ups, the full Discord postpone path reads 293 rows, equal to the normal 1,000-active-request fixture. The repository regression falls from 60,066 reads to fewer than 200.
- Concurrent stale actions can fail with a retry message. This is preferable to corrupting requests.

## Migration Plan

Keep migrations 0001–0010 unchanged. Add a forward-only migration for required schema changes and test it locally. No remote migration or deployment is part of this task.
