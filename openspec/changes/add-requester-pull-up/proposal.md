## Why

Staff can move a requester to a later raid, but they cannot fill an open seat in a reviewed or postponed raid from a later compatible raid. This one-way control leaves avoidable gaps and forces staff to rebuild compatible parties manually.

## What Changes

- Add a planned-raid requester selector that lets authorized staff pull one selected requester from a later raid with the same game mode and map directly from the raid review message.
- Permit a postponed Priority raid to pull an explicitly selected requester from an Ordinary raid and promote only that request to Priority.
- After the pull, attempt to move every remaining source requester together into the immediately following compatible raid when the complete remainder fits; otherwise retain the source party unchanged.
- Keep all pull and push-down changes atomic, bounded by map requester capacity, and free of requester calls.
- Add a mode-and-map ordered D1 index for later planned source discovery and extend the fully local user-facing benchmark through 100,000 requests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `raid-run-planning`: Add pre-call requester pull-up, explicit Ordinary-to-Priority promotion, and bounded source-party push-down behavior.
- `mvp-deployment`: Apply additive migration `0003` and require local D1 performance evidence for the new read and write paths.

## Impact

- Discord raid-detail controls and interaction handling.
- D1 repository transitions, membership history, queue counters, and compatibility enforcement.
- Additive D1 migration `0003`, repository and Discord tests, benchmark contract, and generated performance report.
- No public Twitch or Discord command changes and no requester notification during rearrangement.
- Keep the pull selector visible but disabled when no compatible later requester exists, so staff can see why no pull is available.
- Treat deletion of a planned review message as dismissal: clear its stale board link without recreating the message. Continue to recover missing active-raid details because their result controls remain required.
