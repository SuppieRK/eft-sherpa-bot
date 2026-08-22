## Why

Several staff workflows can exceed platform timing or D1 Free query limits, while production telemetry can omit their background database work. Raid-call status and follow-up cleanup also need tighter lifecycle guards so late best-effort work and accumulated history cannot corrupt or progressively slow current state.

## What Changes

- Record named foreground and background D1 usage for staff work through the tracked execution context.
- Repair no more than 80 legacy requests with a bounded number of D1 statements, including the maximum valid set of priority, game-mode, and map buckets.
- Fence best-effort raid-call status writes to the exact active raid start and pending platform status.
- Acknowledge Discord staff interactions before slow REST work, serialize canonical board updates through the board drain, and reconcile detail messages as bounded background work.
- Mark the canonical board dirty when a stored raid-detail message identity changes so a later drain cannot retain a stale link.
- Stop creating obsolete follow-up relationships when postponement closes the source raid, and remove target-side full-table cleanup without adding an unmeasured write-amplifying index.
- Add regression tests and local D1 benchmarks for telemetry, worst-case legacy repair, stale call completion, Discord timing, and large follow-up history.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `mvp-deployment`: Bound deployment-only repair below the D1 Free per-invocation query limit and require complete background-operation telemetry and focused cost evidence.
- `raid-run-planning`: Make staff interaction acknowledgement, canonical board serialization, detail reconciliation, call-status fencing, and follow-up lifecycle behavior explicit.

## Impact

The change affects the Cloudflare Worker telemetry wrapper, D1 repository queries and migration `0009`, Discord staff interaction handling and REST helpers, raid-call status recording, local Miniflare benchmarks, and integration tests. It does not add durable message delivery, retries, a queue service, or a remote benchmark dependency.
