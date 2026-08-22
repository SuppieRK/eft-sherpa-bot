## Context

The atomic-intake work on `main` removed normal command-time waiting recovery, but several correctness and cost risks remain. A Twitch login change moves the stable user ID to a new mapping row while active requests still use the old login. Discord mutation receipts can commit before their mutation, and Twitch calculates a command reply before checking whether the exact delivery is already stored. Canonical-board synchronization is scheduled independently by every queue change, so bursts can repeat snapshots and Discord updates and an older PATCH can finish last.

The current request telemetry snapshots D1 usage when the HTTP response is ready. `waitUntil()` tasks continue afterward with the same instrumented binding, so their later D1 work is absent from the emitted event. Routine status also counts complete request and receipt tables. Open board snapshots filter current memberships, but single-raid reads and reconciliation can still hydrate historical members or repeat per-raid queries.

Migration `0005` has already reached DEV. This change therefore uses additive migration `0006` and does not edit an applied migration. The completed `reduce-d1-maintenance-costs` OpenSpec change must be synced and archived before this change is archived so its atomic-intake requirements form the baseline.

## Goals / Non-Goals

**Goals:**

- Preserve active requests and duplicate protection when a Twitch user changes login.
- Ensure a failed Discord mutation remains retryable and an exact Twitch replay avoids command-side D1 work.
- Report foreground and every background task separately, including D1 binding calls, statements, rows, duration, outcome, and correlation data.
- Bound routine diagnostics, legacy repair, open-raid hydration, and board reconciliation independently of retained history.
- Coalesce board bursts and prevent stale canonical-board updates from winning.
- Measure each claimed improvement against fully local Miniflare/workerd D1 before accepting it.

**Non-Goals:**

- Change public command words, replies, grouping rules, staff controls, or Discord message layout.
- Remove legacy state `0`, add a cron, add another database, or run performance tests against remote D1.
- Treat custom logs as a substitute for Cloudflare D1 Analytics billing data.
- Gate CI on noisy local wall-clock latency or add Node.js profiling for Worker code.

## Decisions

### Stable Twitch ID is canonical when known

Active-request lookup and uniqueness will use `twitch_user_id` when it is available. Normalized login remains the fallback only for records whose stable ID is unknown. Discord intake will resolve a stored stable Twitch ID from the submitted login inside request creation before it evaluates active-request uniqueness.

Identity observation will merge or move the mapping for a stable Twitch ID and update the current login used by its active requests in the same transactional workflow. This preserves queue lookup and future Twitch mentions. Migration `0006` will add a partial active-request index on stable Twitch ID, mode, and map. Before the unique index is created, it will deterministically keep the oldest active request in any pre-existing duplicate set, cancel later duplicates, and remove their open memberships. The deployment evidence and release notes will disclose any such repair count.

Retaining login-only uniqueness is deliberate: it protects Discord-origin requests that have not learned a stable Twitch ID. A request with a stable ID is first checked by that ID and cannot be duplicated by a renamed login.

### Delivery completion follows durable command state

Discord request-modal creation will stop claiming a separate receipt because `(source_platform, source_delivery_id)` already makes request creation idempotent. For other Discord mutations, receipt completion and the guarded D1 mutation will be one repository transaction where possible. Where an external Discord effect prevents one transaction, the receipt will have an explicit retryable processing state and will become complete only after the durable mutation succeeds. A failed or expired processing claim can be reclaimed; a completed claim cannot repeat the mutation.

Twitch will read a receipt immediately after authentication and command recognition. A sequential exact replay will use the stored reply and status without rebuilding the command result. New deliveries will build the result and use `INSERT ... RETURNING`; the conflict path alone will read the winner. Overlapping new copies may both begin work before one insert wins, but only the stored winning receipt may deliver a reply or request board synchronization. Failed reply delivery retains the existing single-claimer retry behavior.

### Telemetry owns separate foreground and background metric scopes

The Worker will create one D1 metric scope for foreground handling and a new scope for each named `waitUntil()` task. A tracked execution-context helper will emit a background completion or failure event for each task. A final correlated event will aggregate the foreground snapshot and all tracked task snapshots after `Promise.allSettled()` completes. The response remains unblocked.

Metrics will include exact D1 binding calls as well as statements, rows read, rows written, and D1 duration. A `batch()` is one binding call and retains per-statement result metrics. Stable repository query IDs will be passed explicitly to instrumentation through a query registry/helper; benchmark assertions will not infer semantics by matching SQL text. Logs contain no command content, user IDs, secrets, or stored request data.

Cloudflare D1 Analytics remains the authoritative billed total. Operator documentation will explain how to compare aggregate custom metrics with D1 Analytics over the same deployment and time window; discrepancies are investigated rather than hidden by changing local fixtures.

### Routine diagnostics stay bounded

`/internal/status` will retain only facts needed by readiness and deployment verification: bounded schema readiness, legacy-unassigned existence, and a request total read from `staff_statistics_summary` if the response still exposes it. It will not count `event_receipts` or scan `help_requests`. Receipt totals will be omitted instead of adding a routinely callable deep endpoint.

### Raid hydration selects only relevant membership states

Repository reads will distinguish open raids from terminal raids. Planned and active raid reads join only `raid_group_members.state = 0` and use the existing partial open-membership index. Terminal result reads select only the membership state required for that outcome in SQL. Staff handlers will use returned mutation rows or one post-mutation hydration and will not hydrate the same raid before and after unless concurrency validation requires both.

Visible-raid reconciliation will bulk-hydrate the ten board raid IDs and their pull-candidate summaries. It will not run one unrestricted `getRaid()` plus candidate queries per reviewed raid. Tests and benchmarks will attach large removed-member histories to one raid to verify that returned rows and D1 reads stay bounded by current members.

### Legacy repair is bounded by selected demand

Deployment repair still selects at most 80 state-`0` requests. The compatible partial-raid query will be limited to the priority, game-mode, and map buckets represented in that page and will return no more usable groups per bucket than that bucket's demand can consume. Later repair calls process later pages. Empty repair and large unrelated partial-group populations therefore remain bounded.

### Canonical-board updates use dirty versions and a lease/CAS drain

Migration `0006` will add a monotonic board dirty version, a rendered version, and lease metadata to `community_state`. Every queue-changing D1 transaction increments the dirty version. A board drain atomically acquires the expired lease, snapshots the version and visible state, renders and PATCHes the canonical Discord message, then advances the rendered version with compare-and-set. If changes arrived during rendering, the lease holder repeats within a bounded drain budget or schedules another drain. Failed PATCHes do not advance the rendered version, so work remains dirty and retryable.

Manual `Refresh` marks a new dirty version and participates in the same serialized drain. It must return controls derived from its current snapshot; if another lease holder prevents bounded completion, it returns short retry guidance rather than issuing an unordered canonical PATCH. This preserves current Refresh behavior while preventing an older snapshot from overwriting a newer one.

### SQL reductions require measured proof

The implementation will remove the explicit post-membership `UPDATE help_requests SET state = 1` because new intake inserts state `1` and the migration `0005` trigger remains for legacy state `0`. `/link-twitch` will use a void mapping mutation when it does not consume the row. Missing-detail completion will prefer `UPDATE ... RETURNING`. Independent reads may use `batch()` to reduce binding calls, with no claim that batching reduces billed rows.

Migration `0006` will drop `raid_groups_outstanding_idx` only if local D1 `EXPLAIN QUERY PLAN` proves every production lookup uses an equal or better index and the benchmark shows no regression. Unproven index removal is omitted.

### Benchmarks separate stable scale, history, and maintenance

The existing user-facing matrix remains deterministic at 100, 1,000, 10,000, and 100,000 active requests. New suites add:

- exact same-delivery Discord and Twitch replays;
- `/internal/status` operator cost;
- legacy repair for empty, 80-request, multi-page, and large partial-group cases;
- fixed 1,000 active rows with 10,000 and 100,000 terminal requests, closed raids, removed memberships, and retained receipts;
- call, result, postpone, remove, and reconciliation against removed-member history;
- ten reviewed raids and concurrent 10- and 100-request board bursts.

A one-million-row history fixture starts as an explicit scheduled/manual benchmark until its runtime and artifact size are reviewed. CI gates statements, binding calls, rows, writes, and database size, but records latency as informational. A hand-reviewed maximum-budget file is separate from the exact rewritable snapshot. The baseline update command cannot rewrite maximum budgets.

Report provenance will use the Node 26 runtime and a digest of benchmark source, schema, fixtures, and configuration. CI artifacts associate that digest with the exact commit, avoiding the circular claim that a tracked report contains the hash of the commit that contains it. Production deployment verification will run `npm run benchmark:d1` before migration or deployment.

## Risks / Trade-offs

- [Existing stable-ID duplicates need reconciliation] → Repair deterministically in migration `0006`, preserve the oldest active request, report the repair count, and test memberships and statistics.
- [A processing receipt is abandoned] → Use a bounded lease and reclaim only incomplete work; keep the mutation itself guarded by its action key.
- [Board lease holder fails after Discord PATCH] → Use idempotent payloads, CAS rendered versions, and a dirty version that remains retryable; never let an older version mark a newer one rendered.
- [Coalescing delays a board update briefly] → Keep the drain lease and loop bounded and let manual Refresh surface current controls or explicit retry guidance.
- [Custom telemetry double-counts shared work] → Give every background task its own instrumented binding and aggregate immutable snapshots once.
- [Large benchmark fixtures slow normal CI] → Keep 100,000-row contractual cases in CI and start the one-million history case as scheduled/manual evidence.
- [Removing an index improves writes but harms reads] → Require local query-plan and benchmark evidence before the migration drops it.

## Migration Plan

1. Sync and archive the completed `reduce-d1-maintenance-costs` change, then create a feature branch from current `main` before implementation.
2. Add migration `0006` with stable-ID active uniqueness, deterministic duplicate repair, and board synchronization state. Do not edit migrations `0001` through `0005`.
3. Deploy `0006` before the new Worker. The old Worker continues to use existing login uniqueness and ignores additive board columns and indexes.
4. Deploy the Worker, run bounded legacy repair, verify zero legacy unassigned rows, and run platform smoke tests in DEV.
5. Roll back Worker code without reversing `0006` if smoke testing fails. Forward-fix identity or board data; do not restore D1 automatically.

## Open Questions

None.

## Follow-up Runtime Corrections

### Active membership positions use the active maximum

Every path that appends a current raid member will calculate its base position from `max(position)` over `raid_group_members.state = 0`, not from `raid_groups.current_member_count`. This applies to normal intake, bounded legacy materialization, and reusable postponement raids. The member count remains the capacity fact; position is only stable display/order metadata and can contain historical gaps.

### Recycled Twitch logins never merge different stable identities

A mapping at the newly observed login can be merged only when its stable Twitch ID is null or equals the authenticated ID. A different non-null ID is an identity collision. Automatic observation and Twitch request intake will preserve both existing profiles and will not copy Discord display, Discord ID, or EFT name across the collision. The command will fail safely and emit no private profile data. Staff can resolve the exceptional mapping explicitly.

### Board creation and rendering are fenced by one lease

Board synchronization acquires the lease before it hydrates raid details. The lease returns the canonical message ID and dirty version. Creation and 404 replacement commit the message ID and the exact `snapshot.boardVersion` only when the lease token and expected prior message still match. A losing created message is deleted. When one three-attempt drain still has newer work, production schedules another bounded drain through the tracked execution context; final telemetry waits for dynamically scheduled follow-up tasks.

### Discord and Twitch claims use wall-clock leases and fencing tokens

Migration `0007` adds Discord and Twitch claim metadata without changing migration `0006`. Discord retains the signed interaction time as receipt metadata but uses server wall-clock time for expiry. Completion and release require the random claim token.

Twitch claims a new or expired processing receipt before command-side D1 work. Completing that claim stores the reply. A separate random send token permits one external send. Explicit Twitch API rejection clears the send token into retryable failure. An ambiguous network failure or a successful Twitch POST followed by failed D1 acknowledgement keeps the send token and is not retried automatically, favoring at-most-once chat delivery over duplicate messages.
