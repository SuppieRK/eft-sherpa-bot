## Context

The Worker uses Discord HTTP interactions, best-effort `waitUntil()` delivery, one D1 database, and a leased canonical-board drain. Current staff background work can bypass the telemetry task tracker because the tracked execution context is a Proxy whose synthetic `waitUntilTask` member is not visible to the `in` operator. Deployment-only legacy repair can issue one D1 statement for each of 78 valid priority/mode/map buckets, above the D1 Free limit of 50 queries per invocation.

Several Discord staff actions also wait for outbound Discord REST requests before returning the initial interaction response. Manual Refresh performs detail reconciliation before the canonical PATCH under one 30-second board lease, although one Discord request can wait for 20 seconds and Cloudflare gives `waitUntil()` work only 30 seconds after the response. Finally, a late best-effort raid call can overwrite a newer raid run's status, and follow-up cleanup can scan its complete table through an `OR` predicate.

## Goals / Non-Goals

**Goals:**

- Include every named staff background task and its D1 use in final production telemetry.
- Keep one maximum-size legacy repair invocation below the D1 Free 50-query limit.
- Make late raid-call status completion harmless.
- Acknowledge Discord interactions before outbound Discord REST work and keep canonical board writes serialized.
- Ensure detail-message identity changes invalidate the canonical board.
- Bound follow-up cleanup by the source-group primary-key prefix and avoid obsolete relationship writes.
- Validate the changes with integration tests and fully local D1 cost evidence.

**Non-Goals:**

- Durable or guaranteed Discord or Twitch raid-call delivery.
- Automatic retry of canceled, failed, or ambiguous platform sends.
- Cloudflare Queues, another database, or remote D1 benchmarks.
- Reworking normal atomic request intake or the public command interface.

## Decisions

### Use the tracked-context member by value

`scheduleBackground` will cast the supplied context to a partial tracked context and test whether `waitUntilTask` is a function. This uses the Proxy `get` trap directly. Plain Cloudflare execution contexts continue to use `waitUntil()`.

Alternative: add a Proxy `has` trap. This would make the present implementation work, but it couples callers to a synthetic-property implementation detail and does not protect other context implementations.

### Select legacy repair candidates in bounded compound statements

The repair pass will divide the at-most-78 demand buckets into compound statements with four index-seeking branches each. Every branch returns only the earliest compatible open groups required by its bucket. This stays below SQLite's compound-select limit, avoids the full compatible-group reads measured for a window-function alternative, and uses at most 20 candidate statements per pass. It preserves the existing compatible-raid index order and the planner's stable request order. The bounded retry loop, FIFO page, mode heads, candidate selection, queue maxima, mutation batch, and remaining-work check remain below 50 D1 queries for the complete Worker invocation independently of the number of distinct buckets.

Alternative: cap the number of buckets repaired per invocation. That avoids the 50-query failure but adds more deployment calls and can delay low-volume buckets unnecessarily.

### Fence call status to one raid start

The hydrated raid model will carry its `startedAt` epoch. A call-status update will match the raid ID, active state, exact `started_at`, and the platform's pending status. It will set `updated_at` with `max(updated_at, completionTime)`. A late completion from a prior run or a repeated completion writes no row. Discord and Twitch delivery remain concurrent and best effort, and platform-send errors remain separate from status-write telemetry errors.

Alternative: persist a durable outbox. Lost call messages are acceptable for this bot, so an outbox would add operational and schema complexity without meeting a requirement.

### Acknowledge before Discord REST and serialize canonical writes

Discord interactions that need an outbound REST request will return a deferred ephemeral response before that request. Background work will edit the original interaction response through Discord's interaction webhook. Manual Refresh will return a short ephemeral acknowledgement and schedule the canonical drain first. After that drain completes, visible detail reconciliation will run as a separate best-effort task. The Discord REST timeout will remain below the board lease.

No interaction response will directly update the canonical board. Canonical content changes only through the leased drain. Repository changes to a stored raid-detail message identity will atomically increment the board dirty version. Reconciliation will schedule a follow-up drain when it changes an identity, so a cleared or replaced link cannot be falsely acknowledged as current.

Alternative: return a normal ephemeral “working” response and omit the final link or result. This is faster to implement but degrades the existing staff workflow and hides background failure.

### Clean follow-ups only from the source side

Migration `0009` will replace the close trigger's `source = id OR target = id` deletion with source-only deletion, which uses the table's primary-key prefix. A closed target can remain referenced only while its source remains open; candidate queries already require an open target, and closing the source removes all of its relationships. Postponing the source's final requester will not insert a relationship for the source that closes in the same transaction. Reused relationships will use `DO NOTHING` because their timestamp is not consumed.

Alternative: add a target-first index and retain eager target cleanup. That adds an index write for each relationship. The source-owned lifecycle removes the unbounded scan without that write amplification.

## Risks / Trade-offs

- [Deferred background work fails after Discord acknowledgement] → Edit the deferred response with a concise failure when possible; keep mutations idempotent and allow the staff member to use the control again when the workflow permits.
- [Detail reconciliation changes after the first canonical render] → Mark the board dirty transactionally and schedule a second leased drain.
- [Compound legacy-candidate SQL exceeds SQLite limits] → Limit each statement to four index-seeking branches and benchmark the maximum 78-bucket case locally.
- [A target follow-up relationship remains until its source closes] → All relationship readers join only open compatible targets; source closure deletes the bounded source-owned set.
- [Shorter Discord REST timeout rejects a slow but eventual response] → Keep calls best effort and set the timeout below the 30-second lease so a newer drain cannot overlap an older unfenced request.

## Migration Plan

1. Add migration `0009` to replace the follow-up cleanup trigger, and make repository detail-message compare-and-set transactions invalidate the board.
2. Deploy the Worker after the forward migration. Existing follow-up rows remain valid and require no rewrite.
3. Run schema, repository, Discord workflow, telemetry, and local D1 benchmark verification.
4. Roll back Worker code only if it remains compatible with migration `0009`; do not remove the migration or restore D1 data automatically.

## Open Questions

None.
