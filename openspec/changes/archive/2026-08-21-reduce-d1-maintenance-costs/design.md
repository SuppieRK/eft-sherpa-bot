## Context

`createRequest()` currently commits a state-`0` help request, then a later repository operation creates or reuses a raid and inserts its membership. A Worker interruption can strand the request, so `/queue`, `!queue`, and board Refresh scan and repair waiting rows. The generated recovery benchmark consequently measures thousands of D1 row operations that have no product-level purpose.

Migration `0005` is new on the unmerged branch and has not shipped. Production applies migrations before deploying the new Worker, so the migration must remain compatible with the previous Worker. D1 `batch()` executes statements sequentially as one transaction and rolls back the sequence when a statement fails.

## Goals / Non-Goals

**Goals:**

- Commit each valid new request with exactly one planned raid membership or commit nothing.
- Remove waiting selection and assignment from all user-facing commands and board controls.
- Preserve same-mode, same-map, same-queue grouping, capacity, ordering, and idempotency.
- Retain a bounded protected repair path for state `0` rows created by the previous Worker.
- Keep one-snapshot Refresh, leased receipt cleanup, and explainable local D1 evidence.

**Non-Goals:**

- Physically remove numeric state `0` in this release.
- Change public commands, replies, queue ordering, grouping capacity, or postponement behavior.
- Add a cron trigger, another storage service, or user-facing recovery controls.
- Change production telemetry for `waitUntil()` work.

## Decisions

### Commit intake and assignment in one D1 batch

`createRequest()` will receive the configured recipient limit and build one batch containing identity conflict cleanup, mapping upsert, request insertion, compatible raid creation when required, membership insertion, legacy state repair, an invariant assertion, and one final request lookup. New rows will be inserted explicitly as state `1` (`planned`).

Later statements identify the request by source platform and delivery ID, so a logical already-active conflict creates neither a raid nor a membership. The membership statement fills the earliest compatible planned automatic-fill raid or the new queue-tail raid. A final conditional invalid insert will abort the transaction if an active source request has no open membership. D1 capacity and compatibility triggers remain the final concurrency guard.

The repository outcome will include `queueChanged`. It is true for a newly assigned request or a repaired legacy request and false for an unchanged duplicate or already-active request.

### Keep state 0 only as compatibility data

Migration `0005` will continue to accept the previous Worker's default state-`0` inserts and will retain bounded waiting indexes and the waiting-to-planned membership trigger. New code will never persist state `0` during ordinary intake. Postponement already moves planned memberships directly and remains unchanged.

The existing bulk materializer will be renamed as legacy repair and removed from user-facing call sites. An authenticated `POST /internal/repair-unassigned-requests` will repair at most 80 records and return `repaired` plus `hasMore`. Deployment will call it repeatedly until no legacy row remains, then synchronize the canonical board once. `/internal/status` and deployment verification will expose and reject remaining legacy rows.

### Make board effects explicit

Discord and Twitch request handlers will synchronize the board only when `queueChanged` is true. Invalid, duplicate-planned, and already-active requests do no board work. Queue commands read queue facts directly. Board Refresh reads one snapshot, renders it, and reconciles details without assigning requests.

### Retain leased receipt cleanup

Receipt claims will only store duplicate protection. Background maintenance will keep the accepted 15-minute D1 lease and delete at most the oldest 100 receipts older than 24 hours. Failure remains non-fatal.

### Measure user operations, not legacy deployment repair

The stable local benchmark will remove `discord.board.refresh.waiting-backlog` from the user-operation contract. Existing request-create scenarios will assert an immediately planned request and membership. Queue and board scenarios will reject any `materialize.*` statement or assignment write. Legacy repair will remain covered by deterministic integration tests rather than the user-facing benchmark.

## Risks / Trade-offs

- [Previous Worker writes during deployment] → Keep state `0`, its indexes, and repair trigger compatible; run protected repair after the new Worker starts.
- [A conditional assignment silently inserts no membership] → End the batch with an invariant assertion that deliberately violates a constraint and rolls back when an active source request lacks an open membership.
- [Concurrent requests select the same final seat] → Rely on D1 transaction serialization plus existing capacity, compatibility, and unique-position triggers; verify overflow and contiguous positions concurrently.
- [Protected repair is interrupted] → Limit each call to 80, return `hasMore`, and make every call idempotent so deployment can resume.
- [Rollback after new requests] → Preserve existing numeric states and schema semantics so the previous Worker can read and operate on atomically planned requests.

## Migration and Delivery Plan

1. Update the unshipped migration `0005` without rebuilding `help_requests`; preserve old-Worker write compatibility.
2. Implement atomic request intake and remove every user-facing materialization call.
3. Add protected legacy repair, deployment draining, status verification, and regression coverage.
4. Regenerate fully local D1 evidence through 100,000 requests and run complete verification.
5. Update PR #15, commit, and push on the existing branch without deploying.

## Open Questions

None.
