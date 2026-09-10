## Why

The codebase audit found concurrent raid actions that can leave invalid state, follow-up costs that grow with history, and valid messages that exceed platform limits. Public Discord commands can also replace another member's identity link without staff approval.

## What Changes

- Make remove, postpone, and Helped transitions reject stale state without partial writes.
- Keep follow-up ordering valid after repeated pulls and postponements. Bound reads of closed follow-up history.
- Fit Twitch queue replies and Discord raid fields within platform limits.
- Allow public Discord attachment when the target has no Discord member or has the same member. Require staff to replace a different member.
- Correct the documented requester capacity to use configuration and map capacity.
- Add regression tests and local D1 cost evidence. Keep one EFT name per user.

## Capabilities

### New Capabilities

- `audit-safety`: Atomic transitions, bounded follow-up history, output limits, and safe public identity attachment.

### Modified Capabilities

- `raid-run-planning`: Correct the requester-capacity formula and remove closed target relationships.
- `cross-platform-commands`: Restrict replacement of existing Discord links to staff.

## Impact

Repository transactions, identity mapping, Discord and Twitch output, local tests and benchmarks, and a forward-only migration if required. No remote database operations, deployment, new commands, or hosting changes.
