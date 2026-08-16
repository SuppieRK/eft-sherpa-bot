## Why

`Postpone requester` currently creates an isolated raid, so another requester postponed from the same raid and later same-map help requests create separate raids despite available capacity. This wastes raid seats and contradicts the bot's grouping purpose.

## What Changes

- Make requester-postponement follow-up raids eligible for same-map automatic filling.
- Reuse a compatible planned follow-up when multiple requesters are postponed from the same source raid.
- Preserve queue boundaries, queue order, leader reservations, attempt state, and map-specific requester capacity.
- Keep whole-raid postponement isolated from automatic filling.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `raid-run-planning`: Requester postponement creates or reuses a fillable follow-up raid instead of an isolated raid.
- `help-request-tickets`: Later compatible requests can join a requester-postponement follow-up without changing queue kind.

## Impact

The D1 repository's requester-postponement transition and its integration tests change. No command, Discord component, external API, database schema, or deployment configuration changes.
