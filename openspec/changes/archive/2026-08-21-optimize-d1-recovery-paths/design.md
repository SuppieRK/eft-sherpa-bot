## Context

The Worker already keeps normal queue reads bounded and uses a fully local Miniflare/workerd D1 benchmark. Three less common paths remain sensitive to traffic history: Twitch request dispatch repeats identity persistence, receipt claims delete every expired receipt, and crash-recovery materialization loads every waiting request. The shared raid hydration query also transfers historical memberships when the board needs only current members.

The production database has migrations `0001` through `0004`, so schema changes must be additive and forward compatible. The deployment intentionally has no Cloudflare cron trigger. Queue presentation must retain mode fairness, and completed raid reads must retain completed memberships.

## Goals / Non-Goals

**Goals:**

- Reduce normal Twitch request D1 statements without changing replies or duplicate-delivery recovery.
- Bound receipt cleanup and waiting-backlog recovery work performed by one Worker invocation.
- Retain mode presence while a large recovery backlog is drained.
- Remove one obsolete write-amplifying index and add only the waiting-mode index needed for bounded fair selection.
- Prevent open board reads from transferring removed membership history.
- Add repeatable local evidence for adversarial states that the main active-request scale does not represent.

**Non-Goals:**

- Add a scheduled Worker trigger or another storage service.
- Change public command syntax, queue position semantics, grouping capacity, or receipt TTL.
- Remove retained request, raid, membership, or receipt records outside the existing retention policy.
- Gate CI on shared-runner wall-clock time or treat CPU profiles as D1 billing evidence.

## Decisions

### Route Twitch identity persistence by command outcome

The Twitch dispatcher will parse a request before any identity write. A valid `!request` will rely on `createRequest()` for the mapping workflow. An invalid request will write only its delivery receipt. `!queue` will call a specialized `observeTwitchIdentity(): Promise<void>` before the lookup so a current Twitch platform ID can resolve the caller.

After request creation, raid materialization will run only when the returned request state is `waiting`. This covers a newly created request and recovery from a duplicate delivery that previously committed the request but not its assignment. An already planned request will not trigger redundant materialization.

Alternative considered: keep one unconditional observation before dispatch. It is simpler structurally but repeats conflict clearing, upsert, and mapping selection for valid requests and mutates mappings for rejected input.

### Bound foreground receipt cleanup

Each receipt claim will delete at most 250 expired rows using an indexed `ORDER BY received_at LIMIT` subquery before inserting the new receipt. Cleanup remains opportunistic and needs no deployment trigger. Repeated traffic drains a large expired backlog while any individual command has bounded deletion work.

Alternative considered: add a cron trigger. That would remove cleanup from request paths but contradict the intentionally schedule-free Worker and add installation and monitoring work for a small community bot.

### Apply one shared materialization budget per invocation

One `materializeWaitingRequests()` call will materialize at most 250 requests across its existing maximum of three contention retries. Every retry receives only the unspent budget. A pass will select a bounded global FIFO prefix plus the earliest waiting request for each non-empty queue-kind and game-mode pair, deduplicate them, cap the result to the remaining budget, and restore stable queue-kind and arrival ordering before planning.

Migration `0005` will add a partial waiting index keyed by queue kind, game mode, and request ID so the six fixed pair-head lookups do not scan planned requests. This selection can advance a mode head beyond the global batch boundary, which is intentional: stable arrival remains unchanged, per-mode queue order remains stable, and recovery cannot hide an otherwise non-empty mode indefinitely.

Alternative considered: use a window function over all waiting rows. It expresses per-mode reservation compactly but still reads the full backlog and defeats the bound.

### Separate open-board hydration from historical raid hydration

`raidSelectSql` will accept an explicit current-members-only mode. `getBoardSnapshot()` will use it because every selected board raid is planned or active. `getRaid()` will retain the historical join because completed helped raids are represented by completed memberships and several transitions read the committed result.

Alternative considered: add `member.state = 0` to the shared join. That would make completed helped raids appear to have no participants.

### Avoid identity rewrites when values are unchanged

The generic mapping upsert will use a null-safe conflict-update predicate over the effective Twitch ID, Discord ID, Discord display name, and in-game name. A specialized Twitch observation will omit the final mapping `SELECT`, because its caller needs only persistence completion. Conflict-clearing updates remain because a stable platform ID must not point at two Twitch logins.

### Replace the obsolete global queue index in migration 0005

Local `EXPLAIN QUERY PLAN` shows waiting recovery using `help_requests_waiting_order_idx`, caller lookup using `help_requests_twitch_login_idx`, mode prefixes using `help_requests_mode_queue_order_idx`, and active duplicate detection using `help_requests_one_active_mode_map_per_twitch`. Migration `0005` will drop `help_requests_queue_order_idx` and create the waiting pair-head index. Existing Workers ignore the added index and continue to work after the removed redundant index.

### Add focused adversarial benchmark scenarios

The benchmark will retain the complete user-facing 10x scale matrix through 100,000 active requests. It will add focused, fully local stress measurements for 1,000 and 10,000 waiting requests, a large expired-receipt backlog, and an open board raid with substantial removed-member history. D1 statements, rows read, rows written, and database size are release evidence; wall-clock timing remains informational.

The manual Worker CPU profile procedure will replay valid and invalid Twitch requests, queue lookup, and board rendering in addition to signature verification. CPU profiling validates Worker allocation and CPU behavior, while the D1 benchmark remains the source for database cost.

## Risks / Trade-offs

- [A recovery backlog drains across several commands] → Keep a 250-request budget, include every non-empty queue-kind/mode pair, and expose the remaining requests through later commands or board refreshes.
- [Concurrent materializers consume the budget without assigning every selected row] → Retain at most three replans and pass only the remaining materialization budget to each retry.
- [Bounded receipt cleanup can lag after long downtime] → Delete the oldest 250 expired rows on every Twitch receipt and Discord mutation claim; validate convergence with an expired-backlog test.
- [No-op predicates can accidentally suppress a real mapping improvement] → Cover Twitch ID changes, Discord links, display-name changes, in-game-name precedence, and unchanged observations with integration tests.
- [Board filtering can hide terminal participants] → Apply current-member filtering only to `getBoardSnapshot()` and retain historical `getRaid()` coverage.

## Migration Plan

1. Add migration `0005` to drop the obsolete global queue-order index and create the partial waiting queue-kind/mode index.
2. Verify the migration from a schema at migration `0004` and verify the final fresh schema.
3. Run query-plan tests for waiting FIFO, waiting pair heads, caller selection, mode prefixes, and active duplicate lookup.
4. Run repository, Twitch workflow, board workflow, and benchmark contract tests.
5. Regenerate the fully local benchmark report and compare stored D1 baselines before deployment.
6. Deploy migration `0005` before the Worker. A rollback to the previous Worker remains safe because it does not require the removed redundant index and ignores the new index.

## Open Questions

None.
