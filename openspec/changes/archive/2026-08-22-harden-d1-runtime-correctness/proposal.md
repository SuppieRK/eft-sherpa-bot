## Why

The current Worker can lose a viewer's active request after a Twitch login rename, suppress a failed Discord mutation as if it succeeded, and let stale concurrent board refreshes overwrite newer state. Its custom telemetry and benchmarks also omit or underrepresent several D1-heavy background, history, recovery, and operator paths, so further cost work needs stronger local evidence.

## What Changes

- Make stable Twitch user IDs the canonical identity for active-request lookup and uniqueness when an ID is known, while retaining normalized-login fallback for legacy records without an ID.
- Make inbound-delivery handling retry-safe: remove redundant Discord request receipts, prevent a failed Discord mutation from being permanently consumed, and short-circuit exact Twitch replays before command-side D1 work.
- Separate foreground and background-task D1 telemetry, count D1 binding calls, and treat Cloudflare D1 Analytics as the authoritative production billing source.
- Make routine status checks bounded, constrain open-raid hydration to current members, and bound legacy repair by the waiting demand being processed.
- Coalesce canonical-board updates with a D1 dirty-version and lease/CAS drain so bursts do not issue one full refresh per request or allow an older snapshot to win.
- Remove verified redundant statements and indexes, and use `RETURNING` or void mutation paths where local D1 evidence confirms lower cost.
- Extend the fully local benchmark with operator, duplicate-delivery, recovery, history, reconciliation, and burst scenarios; add stable query IDs, binding-call counts, hand-reviewed maximum budgets, and current provenance.
- Apply all schema changes through additive migration `0006`; migrations already applied to DEV remain unchanged.
- Add forward-only migration `0007` for fenced Discord and Twitch processing claims; keep the already-applied migration `0006` unchanged.
- Allocate new raid memberships after the highest active position so removed-position gaps cannot block later intake, repair, or postponement.
- Reject cross-user Twitch login collisions instead of transferring Discord or EFT identity details between stable Twitch IDs.
- Fence canonical-board creation, replacement, completion, and bounded follow-up work with the exact rendered snapshot version.
- Route manual board refresh through the same leased canonical update as background synchronization, with no second interaction-response write.
- Keep raid-call delivery explicitly best effort: return the interaction response first, send Discord and Twitch calls concurrently in tracked background work, do not retry, and record delivery status without changing the platform outcome when the status write fails.
- Bound legacy repair before candidate ranking and measure pull/postpone behavior against extensive removed-member history before adding any history index or summary structure.
- Reject older Twitch identity observations after a newer stable-identity observation has committed.
- Make local benchmark evidence cover the actual Worker source and failure paths, use operation-family budgets, and upload only evidence produced by the successful current run.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `help-request-tickets`: Use stable Twitch identity for active-request continuity and duplicate prevention across login changes.
- `cross-platform-commands`: Make Discord and Twitch delivery idempotency retry-safe and cheap for exact replays.
- `raid-run-planning`: Bound raid hydration and repair work, and serialize/coalesce canonical-board synchronization.
- `mvp-deployment`: Add migration `0006`, complete foreground/background D1 observability, bounded diagnostics, and evidence-based performance gates.

## Impact

The change affects the D1 schema and repository queries, Discord and Twitch webhook handlers, board synchronization, Worker telemetry, local Miniflare benchmarks, deployment verification, and regression tests. It does not change public viewer commands or staff workflow wording. The follow-up hardening work uses additive migrations `0007` and `0008` and leaves applied migrations unchanged. Raid-call and Twitch reply delivery remain intentionally best effort and at most once; this change does not add an outbox, retries, or a cleanup Cron Trigger.
