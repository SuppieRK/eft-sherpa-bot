## 1. Telemetry and call fencing

- [x] 1.1 Route staff background work through the tracked execution-context function and add production-path telemetry regression coverage.
- [x] 1.2 Carry the exact raid start through hydration and fence Discord and Twitch call-status writes by active state, start, and pending status.
- [x] 1.3 Add tests for current, duplicate, late, restarted, and monotonic call-status completion.

## 2. Bounded D1 maintenance

- [x] 2.1 Replace per-bucket legacy candidate statements with bounded compound index-seeking selections that preserve compatible stable ordering.
- [x] 2.2 Add a maximum 78-bucket repair test and local benchmark assertion below the D1 Free 50-query limit.
- [x] 2.3 Add migration `0009` for source-owned follow-up cleanup and transactional board invalidation on detail-message identity changes.
- [x] 2.4 Stop obsolete and duplicate follow-up writes and add large unrelated-history cleanup tests and benchmark evidence.

## 3. Discord interaction timing and board consistency

- [x] 3.1 Add deferred ephemeral interaction responses and bounded interaction-webhook completion for REST-dependent staff actions.
- [x] 3.2 Make Refresh drain the canonical board before separate best-effort detail reconciliation and schedule a follow-up drain after identity changes.
- [x] 3.3 Keep the Discord REST timeout below the board lease and add slow, failed, stale-link, and concurrent interaction regression tests.

## 4. Verification

- [x] 4.1 Update deterministic local D1 baselines and generated performance evidence for the changed operation families.
- [x] 4.2 Run schema tests, unit tests, integration tests, type checking, formatting, static analysis, and the full local D1 benchmark.
- [x] 4.3 Validate the OpenSpec change against the implementation and mark every completed task.
