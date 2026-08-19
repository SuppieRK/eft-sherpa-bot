## Context

The canonical Discord board intentionally shows only a bounded raid overview. Full requester identities, goals, and notes already fit in a raid-specific message, but that message is currently created only after the board selector has assigned its caller as leader, activated attempt one, and sent Discord and conditional Twitch calls. Consequently, staff cannot inspect or correct an automatically grouped party before its requesters are notified.

Automatic grouping by queue kind, game mode, and map remains the throughput mechanism. Requester capacities and map-specific limits remain unchanged. The design changes when a planned group becomes committed: a planned group is a draft until authorized staff explicitly call and start it.

Discord limits all embeds in one message to 6,000 characters. The board can therefore remain predictable only if full request text stays in a one-raid detail message. The existing `planned` and `active` raid states, `automatic_fill`, call-status fields, `staff_message_id`, receipt claims, and compare-and-set message ownership are sufficient; no schema migration is required.

## Goals / Non-Goals

**Goals:**

- Preserve automatic grouping, mode safety, fair queue order, and existing requester limits.
- Let staff inspect and correct a complete proposed party before any requester call or attempt begins.
- Make the successful `Call and start raid` caller the leader.
- Keep one recoverable detailed message per reviewed or active raid and prevent duplicate messages, starts, and calls.
- Permit pre-call requester movement and removal without weakening the existing active-raid controls.
- Keep board and review operations bounded and include both in local performance evidence.

**Non-Goals:**

- Display complete goals or notes on the canonical board.
- Replace automatic grouping with manual party construction or add requester-assignment controls.
- Change requester capacities, map party capacities, mode fairness, queue ordering, attempt limits, or call destinations.
- Reserve a helper seat or model additional volunteers in party occupancy.
- Add Pause, Resume, pagination, leader reassignment, or a new persisted raid state.

## Decisions

### Use the existing planned state as the draft state

Selecting a planned raid from the board will become `Review a raid`. Review keeps the raid in `planned`, leaves attempt count at zero, leaves calls `not_requested`, and assigns no leader. This avoids a migration and keeps queue calculations unchanged.

Alternative considered: add a separate `reviewing` state. It would make the state name explicit, but it would expand every open-raid query, trigger, benchmark, recovery path, and rollback path without adding behavior that cannot be represented by planned state plus a staff-message identity.

### Freeze membership when review opens

The repository will atomically mark the selected planned raid as unavailable for further automatic filling before its detailed message is rendered. Once staff have inspected a proposed party, a later matching request must enter another compatible planned raid rather than appear silently in an already reviewed message.

An abandoned reviewed raid remains a valid planned raid with stable membership and can be reviewed or started later by eligible staff. The MVP will not add a release-or-resume-filling control.

Alternative considered: continue automatic filling and refresh the message. That allows the party to change between review and call, undermines confirmation, and introduces a race where an unseen requester can be called.

### Persist one shared review message and reuse it after activation

The first review creates a detailed staff-channel message containing full request information, a clear `No requesters have been called` state, and pre-call controls. Its reviewer can be mentioned for notification without becoming leader. The message ID is attached with compare-and-set; concurrent review attempts delete losing duplicates and return the retained message link. Later reviews reuse the retained message.

The canonical board remains high-level but may link a reviewed planned raid to its details. On successful start, the same message is updated to the active view instead of creating another message.

Alternative considered: use only an ephemeral review response. That avoids channel messages but prevents shared staff review, cannot provide a durable board link, and has a shorter useful interaction lifetime.

### Separate planned and active authorization

Any configured streamer or current volunteer-role member may open and operate pre-call review controls. No reviewer owns the draft. `Call and start raid` uses one conditional D1 transition from planned to active; the first valid caller becomes leader. A source with an existing reserved leader retains the current rule that only that leader or the streamer may start it.

After activation, raid-result and requester controls remain restricted to the assigned leader and configured streamer. Concurrent or repeated call actions receive a private stale-action response and cannot send another call.

### Treat Call and start as the commitment boundary

`Call and start raid` will atomically set the leader, leader type, active state, attempt one, start time, and pending/not-requested call statuses. Discord and Twitch delivery occurs only after that transition and targets only current memberships. The detail message is then refreshed with the actual call statuses and active controls.

External Discord or Twitch failures do not roll back the active database state. Existing per-platform status updates expose partial failure and keep retries or operator diagnosis deterministic.

### Make controls depend on raid state

The planned message exposes:

- `Call and start raid`
- `Move requester to next raid`
- `Remove requester`

It does not expose attempt results or whole-raid postponement. The active message retains the current result, requester-postponement, and removal controls and does not expose another call button.

Moving a requester from a reviewed planned raid uses the same compatible follow-up-chain rules as active individual postponement. The reviewed source remains frozen if members remain. If movement or removal empties the source, the source closes, its stored message identity clears, and its review message is deleted.

### Extend message recovery to visible planned reviews

The current compare-and-set repair flow will cover visible planned raids that have a stored detail identity as well as active raids. A confirmed Discord `404` clears and recreates one message from current D1 state without calls or state changes. Non-404 failures retain the identity. Concurrent repairs retain one winner and delete duplicates.

### Version the Discord component contract safely

The canonical board component version will advance so an old `Start a raid` selector cannot invoke the new Worker and bypass review. Old start components will receive short refresh guidance. Existing active detail controls will remain accepted during deployment until those raids finish, while new review and active messages use the new component version.

Using `Refresh` on the canonical board will update that same message with a complete newly rendered board payload, including its current-version controls. Discord component rows will be replaced rather than retained or patched individually, so the retired `Start a raid` selector and options for raids that are no longer reviewable disappear immediately.

### Benchmark the two user-facing transitions separately

The local seeded benchmark will replace the old combined raid-start case with a planned-review case and a streamer-led call-and-start case at every existing 10x size through 100,000 requests. The report will retain latency and D1 rows read and written so the extra review step has explicit cost evidence.

## Risks / Trade-offs

- **Reviewed raids stop accepting later compatible requests** → Freeze only when staff deliberately opens review; unreviewed raids continue automatic filling, and abandoned reviewed raids remain runnable.
- **A reviewer may be mistaken for the leader** → State explicitly that no leader is assigned and make only the successful call-and-start caller the leader.
- **Concurrent reviewers may create duplicate Discord messages** → Attach with compare-and-set and delete every losing message.
- **A database start may commit before an external call or message update fails** → Persist call statuses, keep the active transition, and recover the message from D1 rather than repeating the start.
- **Old board components could retain immediate-start semantics** → Reject the retired component version and require board refresh; keep only compatible active-detail actions during rollout.
- **A refreshed board could retain stale component rows or options** → Replace the canonical message's complete component collection with controls rendered from the current D1 snapshot and current component version.
- **Persistent review messages add staff-channel noise** → Reuse one message per raid, link it from the board, and delete it when the raid becomes terminal or is moved back to Priority.
- **Allowing any staff member to edit a draft permits concurrent corrections** → Guard each mutation with delivery receipts and current-state/member predicates; stale controls fail privately.

## Migration Plan

1. Deploy the Worker with the new component parser, review transition, state-aware detail renderer, and backward-compatible active-detail handling.
2. Refresh the canonical board so only the new `Review a raid` selector remains visible.
3. Leave existing active raids and their detail messages unchanged until they complete; existing planned raids become reviewable without data conversion.
4. Smoke-test review with an automatically grouped raid, verify no calls or leader assignment, move one requester, then call and start as both streamer and volunteer cases.
5. For rollback, first clear planned review-message identities and re-enable automatic filling only for unreserved planned raids; then restore the previous verified Worker. Prefer forward repair after any reviewed draft exists so immediate-start behavior is not accidentally restored.

## Open Questions

None. The streamer confirmed the high-level board, automatic grouping, existing requester limits, manual call action, and call-time leader assignment.
