## Why

The staff board currently shows party occupancy such as `2/5`, but that value includes an implicit leader seat even when no leader is assigned. Staff can mistake it for two queued requesters, so the overview should show the actual Twitch requester identities instead.

## What Changes

- Remove the leader-inclusive occupancy fraction from every canonical board raid heading.
- Show the Twitch login of every current requester in each displayed raid.
- Keep full objectives, notes, capacity, and leader details out of the bounded board overview and in the raid-specific detail message.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `raid-run-planning`: Change the canonical board raid summary from implicit party occupancy to explicit Twitch requester identities.

## Impact

- Discord staff-board rendering and its unit tests.
- The raid-planning UX contract; no database, command, grouping, or deployment configuration changes.
