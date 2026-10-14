## Why

The separate priority queue reserves board space and obscures waiting raids. Raid attempt recording is unused. The streamer needs direct control over service order and access to all raids through one visible list.

## What Changes

- **BREAKING**: Replace ordinary and priority queues with one ordered raid list. Preserve all existing data through a numbered forward migration.
- Add streamer-only **Pin to top** and **Unpin** controls. Keep normal grouping placement independent of manual service placement.
- Add streamer-controlled keyset pages of ten raids to the shared Discord board. Refresh and every data update reset to page one.
- Update viewer queue selection and positions to match effective raid service order.
- Move postponed raids to the unified tail. Keep automatic filling until review.
- Restrict reviewed requester movement to existing eligible later raids across the full backlog. Hide the control when no destination exists; retain active requester follow-up creation.
- **BREAKING**: Remove raid attempt counters, unsuccessful-attempt recording, and `ATTEMPT_LIMIT` from the active configuration contract.
- Preserve authorization, atomic transitions, delivery deduplication, canonical message leases, and reviewed SQL cost ceilings.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `raid-run-planning`: Unified ordering, manual placement, paged board, and attempt-free lifecycle.
- `help-request-tickets`: Group compatibility and postponement without queue kinds.
- `cross-platform-commands`: Viewer positions follow effective raid and membership order.
- `fixed-mvp-configuration`: Remove attempt policy and split display windows; retain bounded reads and local evidence.
- `mvp-deployment`: Forward data migration and benchmark coverage for navigation and ordering.
- `schedule-independent-operations`: Retain explicit state transitions without attempt state.

## Impact

D1 schema, repository queries and mutations, Discord rendering and handlers, deployment configuration, generated Worker bindings, operator guides, fixtures, integration tests, and local benchmark contracts. No new dependency, service, or production deployment is required.
