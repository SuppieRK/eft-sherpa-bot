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

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `help-request-tickets`: Use stable Twitch identity for active-request continuity and duplicate prevention across login changes.
- `cross-platform-commands`: Make Discord and Twitch delivery idempotency retry-safe and cheap for exact replays.
- `raid-run-planning`: Bound raid hydration and repair work, and serialize/coalesce canonical-board synchronization.
- `mvp-deployment`: Add migration `0006`, complete foreground/background D1 observability, bounded diagnostics, and evidence-based performance gates.

## Impact

The change affects the D1 schema and repository queries, Discord and Twitch webhook handlers, board synchronization, Worker telemetry, local Miniflare benchmarks, deployment verification, and regression tests. It does not change public viewer commands or staff workflow wording. The follow-up hardening work uses additive migration `0007` and leaves applied migrations unchanged.
