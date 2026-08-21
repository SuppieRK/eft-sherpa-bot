## Why

The reviewed D1 benchmark exposed recurring reads, repeated board hydration, and expensive foreground maintenance. Further review showed that the largest recovery path exists only because request insertion and raid assignment commit separately. A valid request always has a destination, so normal traffic should commit one planned request with one raid membership atomically instead of leaving work for later commands.

## What Changes

- Create or resolve the user mapping, help request, compatible raid, and membership in one transactional D1 batch.
- Make every successful new request immediately planned; reserve database state `0` only for previous-Worker compatibility and protected legacy repair.
- Remove waiting-request materialization from Discord and Twitch commands and from board Refresh.
- Retain one-snapshot board Refresh and leased receipt cleanup.
- Repair any legacy unassigned rows only through an authenticated internal deployment operation.
- Replace the waiting-backlog user benchmark with atomic-intake and zero-maintenance command gates.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `help-request-tickets`: Valid intake atomically creates a planned request and membership.
- `mvp-deployment`: Migration `0005` remains backward-compatible while deployment drains legacy unassigned rows through a protected endpoint.
- `raid-run-planning`: Queue and board operations no longer perform request assignment; Refresh retains one consistent snapshot.

## Impact

The change affects request creation, Twitch and Discord dispatch, the D1 repository, migration `0005`, protected deployment diagnostics, local benchmark evidence, integration tests, and PR #15. Public command syntax, replies, grouping compatibility, queue fairness, and requester capacities do not change.
