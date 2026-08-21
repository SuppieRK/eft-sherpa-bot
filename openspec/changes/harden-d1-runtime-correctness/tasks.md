## 1. Change and Branch Preparation

- [x] 1.1 Create a new feature branch from the current clean `main` before changing implementation files.
- [x] 1.2 Sync and archive the completed `reduce-d1-maintenance-costs` change so its atomic-intake specifications become the baseline for this change.
- [x] 1.3 Record current fully local D1 benchmark and query-plan evidence before optimization, using Node 26 and no remote binding.

## 2. Migration 0006 and Stable Twitch Identity

- [x] 2.1 Add migration `0006` with additive board synchronization state and a partial active-request uniqueness index on stable Twitch user ID, game mode, and map; leave migrations `0001` through `0005` unchanged.
- [x] 2.2 Add deterministic migration SQL that retains the oldest active stable-ID duplicate, cancels later duplicates, removes their open memberships, and exposes the repair count for deployment evidence.
- [x] 2.3 Make Twitch identity observation transactionally merge or move the stable-ID mapping and update active requests to the authenticated normalized login without detaching Discord or EFT details.
- [x] 2.4 Make request creation and queue lookup prefer stable Twitch user ID and use normalized-login fallback only when the stable ID is unknown, including Discord intake through a known mapping.
- [x] 2.5 Cover rename → `!queue` → duplicate request, current Twitch mention, Discord mapped intake, unknown-ID fallback, mapping conflicts, different modes, and concurrent duplicate creation.
- [x] 2.6 Cover migration `0006` on clean data, pre-existing renamed-login duplicates, membership/statistics repair, previous-Worker readability, and repeated migration verification.

## 3. Retry-Safe Delivery Idempotency

- [x] 3.1 Remove the redundant Discord request-modal receipt and prove source-delivery uniqueness returns the existing planned request on an exact replay.
- [x] 3.2 Inventory every Discord mutating interaction and make its completion receipt atomic with the guarded D1 mutation or explicitly retryable until the durable mutation commits.
- [x] 3.3 Add bounded claim leases and completion states where external Discord effects prevent one D1 transaction; keep action keys idempotent across reclaim.
- [x] 3.4 Pre-read Twitch receipts after authentication and command recognition so a sequential exact replay skips identity, request, queue, and board command work.
- [x] 3.5 Store a new Twitch reply with `INSERT ... RETURNING`, use a conflict lookup only for the losing path, and permit only the stored winner to deliver or schedule board synchronization.
- [x] 3.6 Cover failed Discord mutations, expired incomplete claims, exact completed replays, overlapping Twitch deliveries, failed Twitch reply retry, and the invariant that no delivery is lost or externally applied twice.

## 4. Complete D1 Telemetry and Bounded Status

- [x] 4.1 Extend D1 metrics with exact binding-call counts while preserving per-statement rows, writes, duration, and batch result accounting.
- [x] 4.2 Add explicit stable query IDs at repository preparation sites and replace benchmark SQL-text classification with those IDs.
- [x] 4.3 Add a tracked execution-context helper that gives foreground handling and each named `waitUntil()` task independent instrumented D1 bindings and correlated immutable snapshots.
- [x] 4.4 Emit foreground, per-background-task completion or failure, and final aggregate usage events without delaying the response or logging user data, command text, or secrets.
- [x] 4.5 Route Twitch delivery/status/cleanup/board work and Discord cleanup/board/reconciliation work through the tracked background-task helper.
- [x] 4.6 Replace full request and receipt counts in `/internal/status` with indexed existence checks and the singleton submitted-request rollup; update deployment consumers and tests.
- [x] 4.7 Document that Cloudflare D1 Analytics is authoritative for billing and how operators compare it with custom metrics over the same deployment and time window.
- [x] 4.8 Cover batch binding counts, independent concurrent task scopes, final aggregation, safe failure codes, missing task metrics, bounded status cost, and telemetry field sanitization.

## 5. History-Bounded Raid Reads and Legacy Repair

- [x] 5.1 Split open and terminal raid hydration so planned/active reads join only current memberships and terminal reads select only outcome-relevant membership states in SQL.
- [x] 5.2 Refactor staff mutations to reuse returned rows or one post-mutation hydration and remove unnecessary before/after `getRaid()` calls without weakening concurrency checks.
- [x] 5.3 Bulk-hydrate the ten visible raid IDs and their pull-candidate summaries for detail reconciliation instead of running unrestricted per-raid queries.
- [x] 5.4 Restrict each 80-request legacy repair pass to partial raids in the selected priority/mode/map buckets and cap each bucket's groups by selected demand.
- [x] 5.5 Cover call, result, postpone raid, postpone requester, remove requester, pull-up/push-down, and detail reconciliation with current participants plus extensive removed-member history.
- [x] 5.6 Cover empty repair, one page, multiple pages, mixed buckets, unrelated partial-group populations, concurrency, and stable repair order.

## 6. Coalesced Canonical Board Synchronization

- [x] 6.1 Add repository operations to increment board dirty version in every queue-changing transaction and atomically acquire, renew, and release the board drain lease.
- [x] 6.2 Implement a bounded board drain that snapshots one dirty version, PATCHes the canonical message, compare-and-set advances the rendered version only on success, and continues when newer work exists.
- [x] 6.3 Route Discord and Twitch queue-change background work through the coalescing drain so concurrent triggers share work and only the stored Twitch receipt winner marks the board dirty.
- [x] 6.4 Make manual `Refresh` participate in the serialized drain, return current-version controls, and show short retry guidance instead of issuing an unordered PATCH when it cannot complete in bounds.
- [x] 6.5 Cover 10- and 100-request bursts, an older PATCH completing last, lease-holder failure, lease expiry, changes during rendering, bounded drain exhaustion, missing canonical messages, and simultaneous reviewed raid details.
- [x] 6.6 Verify that board calls, detail cancellation, deleted-message behavior, pull controls, and current single-snapshot Refresh UX remain unchanged.

## 7. Measured SQL and Index Reductions

- [x] 7.1 Remove the redundant intake `UPDATE help_requests SET state = 1` while retaining migration `0005` legacy state repair and its regression tests.
- [x] 7.2 Add a void mapping mutation for `/link-twitch` and use `UPDATE ... RETURNING` for missing Discord/EFT completion paths when the returned row replaces a follow-up lookup.
- [x] 7.3 Batch independent board and mode-prefix reads where it lowers binding calls, and report rows separately without claiming a billed-row reduction.
- [x] 7.4 Run local D1 `EXPLAIN QUERY PLAN` for every production outstanding-raid lookup with and without `raid_groups_outstanding_idx`; drop it in migration `0006` only if all plans and benchmarks remain equal or better.
- [x] 7.5 Add regression tests for every removed statement, retained trigger behavior, returned mutation data, and final schema index set.

## 8. Fully Local Performance and Cost Evidence

- [x] 8.1 Retain the complete user-facing benchmark matrix at 100, 1,000, 10,000, and 100,000 active requests and add exact D1 binding-call assertions.
- [x] 8.2 Add exact same-delivery Discord and Twitch scenarios and separate first-delivery, replay, overlapping-delivery, and failed-reply-retry measurements.
- [x] 8.3 Add operator and maintenance suites for `/internal/status`, empty repair, one 80-request repair page, multiple pages, and large unrelated partial-group populations.
- [x] 8.4 Add a history dimension with 1,000 active rows plus 10,000 and 100,000 terminal requests, closed raids, removed memberships, and retained receipts; keep a one-million-row case scheduled/manual until its runtime is reviewed.
- [x] 8.5 Benchmark call, one raid result, postpone, remove, ten reviewed-raid reconciliation, and concurrent 10- and 100-request board synchronization against adversarial history.
- [x] 8.6 Add a separate hand-reviewed maximum-budget file for binding calls, statements, rows, writes, and database size; prevent `--update-baseline` from rewriting it and keep wall-clock latency informational.
- [x] 8.7 Replace stale commit provenance with Node 26 plus a digest of benchmark source, migrations, fixtures, and configuration, and associate CI artifacts with the exact commit.
- [x] 8.8 Regenerate the committed fully local report, explain every material change with measured data, and confirm that no benchmark or test contacts remote D1 or platform APIs.

## 9. Verification and Delivery

- [x] 9.1 Add `npm run benchmark:d1` to production deployment verification before any migration, secret upload, platform configuration, or Worker deployment.
- [x] 9.2 Run formatting, Biome, typed Oxlint, TypeScript, Knip, migration checks, unit/integration tests, build, secret checks, strict OpenSpec validation, and the complete local D1 benchmark.
- [x] 9.3 Update ASD-STE100 operator and release documentation for migration `0006`, duplicate repair evidence, D1 Analytics comparison, rollback, and DEV smoke verification.
- [x] 9.4 Commit the completed change on the feature branch, push it, create a GitHub pull request with measured before/after evidence, and manually deploy that exact branch version to DEV for Discord and Twitch smoke testing.
