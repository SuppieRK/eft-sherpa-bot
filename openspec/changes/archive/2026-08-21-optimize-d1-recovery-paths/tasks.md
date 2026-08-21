## 1. Twitch command and identity cost

- [x] 1.1 Route valid Twitch requests through one identity workflow, reject invalid requests without mapping writes, and observe identity only for queue lookup.
- [x] 1.2 Materialize a Twitch request only when the returned request remains waiting, including duplicate-delivery recovery coverage.
- [x] 1.3 Add a no-read Twitch observation path and prevent unchanged generic mapping observations from updating rows.
- [x] 1.4 Add integration tests for valid, invalid, duplicate waiting, duplicate planned, queue observation, identity conflicts, changed details, and unchanged observations.

## 2. Bounded D1 maintenance and recovery

- [x] 2.1 Limit each foreground receipt cleanup to the oldest 250 expired rows and test backlog convergence for Twitch and Discord claims.
- [x] 2.2 Limit one materialization invocation to 250 requests across contention retries while reserving each non-empty queue-kind and game-mode pair.
- [x] 2.3 Add recovery tests for 1,000 and 10,000 waiting rows, mixed queue kinds and modes, remaining-budget retries, grouping capacity, and later-batch drainage.

## 3. Schema and board reads

- [x] 3.1 Add forward-compatible migration `0005` to replace the obsolete global queue-order index with the waiting queue-kind/mode head index.
- [x] 3.2 Add schema and `EXPLAIN QUERY PLAN` tests for migration upgrade, fresh schema, waiting FIFO, waiting pair heads, caller lookup, mode prefixes, and active duplicate lookup.
- [x] 3.3 Filter open board hydration to current memberships while retaining completed participants in single-raid historical reads.
- [x] 3.4 Add adversarial repository and Discord board tests with substantial removed-member history.

## 4. Performance evidence and verification

- [x] 4.1 Add fully local benchmark scenarios for 1,000 and 10,000 waiting requests, an expired-receipt backlog, and removed-member board history.
- [x] 4.2 Extend benchmark contracts and stored baselines for statements, rows read, rows written, and database size while keeping latency informational.
- [x] 4.3 Document a manual workerd CPU-profile replay that includes request creation, invalid requests, queue lookup, and board rendering.
- [x] 4.4 Run focused tests, complete repository verification, strict OpenSpec validation, and the fully local D1 benchmark; review and record the resulting cost changes.
