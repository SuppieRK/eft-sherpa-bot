## Why

Four Discord action paths repeat receipt handling and use different failure scopes. Two query classes only forward calls and add no behavior.

## What Changes

- Use one Discord mutation receipt module for identity edits and raid controls.
- Keep a receipt pending if the action succeeds but receipt completion fails. Retain the existing claim lease and retry behavior.
- Keep staff domain rejections terminal and release claims when the guarded action fails.
- Remove the queue and statistics forwarding classes. Keep domain types, bounded queries, and platform response text.
- Add regression tests and rerun the fully local D1 benchmark without increasing cost budgets.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cross-platform-commands`: Define a common receipt completion failure policy for Discord mutations.

## Impact

Discord command handling, staff controls, two domain query files, tests, and local benchmark reports. No new dependency, migration, platform command, hosting resource, durable outbox, or guaranteed raid call.
