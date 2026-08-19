## Why

Selecting a planned raid currently commits the automatically grouped party before staff can review its complete goals and notes: it assigns the selector as leader, starts attempt one, and sends requester calls immediately. Automatic grouping remains valuable for throughput, but staff need a deliberate confirmation point where they can inspect and correct the proposed party before anyone is notified.

## What Changes

- Keep `/board` as a bounded high-level overview and retain automatic grouping, mode safety, queue ordering, and existing requester-capacity limits.
- Replace the board's immediate start action with a review action that creates or reuses one detailed staff message for the planned raid without assigning a leader, starting an attempt, or calling requesters.
- Show full requester identities, goals, and notes in the planned review message, state clearly that nobody has been called, and allow authorized staff to move or remove requesters before the raid starts.
- Add a manual `Call and start raid` control. Its successful caller becomes the leader, attempt one begins, and the existing Discord and conditional Twitch calls are sent only for the raid's current members.
- Reuse the same detailed message after activation, retain idempotent message recovery and transition handling, and prevent concurrent staff actions from starting or calling the same raid twice.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `raid-run-planning`: Change planned-raid selection from an immediate start-and-call transition into a review-first workflow with editable draft membership and an explicit manual call-and-start commitment.

## Impact

- Discord staff-board rendering, component identifiers, interaction handling, detailed-message lifecycle, authorization, and recovery behavior.
- D1 repository transitions for planned requester movement/removal, atomic leader claim and activation, and duplicate/concurrent action protection; no schema migration is expected.
- Discord and Twitch call timing and recipient selection.
- Board, repository, workflow, benchmark, operator-documentation, and OpenSpec regression coverage.
