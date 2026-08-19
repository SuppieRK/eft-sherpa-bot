## 1. Discord component and view contracts

- [x] 1.1 Add versioned Discord component identifiers and parsers for `Review a raid` and `Call and start raid`; reject retired board-start components with refresh guidance while retaining compatible active-detail controls during rollout, and make the refreshed board payload replace every old component row.
- [x] 1.2 Update the staff-board view contract to keep its bounded high-level summary, label the selector as `Review a raid`, and link reviewed planned raids to their retained detail messages without displaying complete goals or notes.
- [x] 1.3 Add a planned-review detail view that shows game mode, map, every current requester identity, full goal and notes, attempt zero, leader state, and the explicit no-calls state with only call/start, move, and remove controls.
- [x] 1.4 Keep the active detail view and its existing result controls, but ensure the successful call/start caller is rendered as leader and no second call/start control is available.

## 2. Atomic D1 review and activation transitions

- [x] 2.1 Add an atomic repository review transition that accepts only a current planned raid, disables automatic filling, and returns its frozen membership without assigning a leader, incrementing attempts, or changing either platform call status.
- [x] 2.2 Extend detail-message compare-and-set ownership and lookup to reviewed planned raids while preserving active-raid behavior and allowing terminal or empty raids to clear their retained message identity.
- [x] 2.3 Add one conditional call-and-start transition that accepts only an eligible current planned review, makes its first successful caller the leader, starts attempt one, initializes call statuses, and returns only current members for delivery.
- [x] 2.4 Preserve the reserved-leader-or-streamer rule for postponed follow-ups and make concurrent or repeated call/start attempts fail without changing state or producing another delivery.
- [x] 2.5 Extend requester movement and removal transactions to reviewed planned raids, retaining frozen state when members remain and atomically closing an empty source while preserving all current active-raid semantics.

## 3. Discord review workflow and recovery

- [x] 3.1 Change board raid selection to freeze and review the party, create or reuse one persistent detail message, mention only the first reviewer for notification, refresh the board link, and send no requester call.
- [x] 3.2 Resolve concurrent review-message creation with compare-and-set, delete losing duplicate messages, and return the retained detail-message link to every later reviewer.
- [x] 3.3 Implement `Call and start raid` authorization and handling so the winning caller becomes leader, Discord calls current members, Twitch calls remain conditional on a streamer leader, delivery statuses are persisted, and the same detail message becomes the active view.
- [x] 3.4 Apply planned-review move and remove controls for any configured streamer or eligible volunteer, refresh both the detail and board state, and delete an obsolete detail message when its source becomes empty.
- [x] 3.5 Reconcile both reviewed planned and active detail messages during `/board` and `Refresh`: retain successful reads, recreate only confirmed `404` messages from D1 state without side effects, retain identities after non-404 failures, delete concurrent replacement losers, and update the canonical board in place with a complete current snapshot and fully replaced current-version controls.

## 4. Regression and workflow tests

- [x] 4.1 Add unit tests for new and retired component parsing, high-level board rendering, planned full-detail rendering and controls, active controls, leader labels, attempt labels, call labels, and Discord length limits.
- [x] 4.2 Add repository integration tests proving review freezes membership without calls or leadership, later compatible requests cannot join the reviewed raid, and existing same-mode grouping and map-specific requester capacities remain unchanged.
- [x] 4.3 Add repository integration tests for streamer and volunteer activation, reserved-leader denial, exactly one winner under concurrent starts, current-member call recipients, and no duplicate activation or call state.
- [x] 4.4 Add repository integration tests for moving and removing requesters before calls, compatible follow-up reuse, mode-safe destinations, frozen non-empty sources, and atomic closure of empty sources.
- [x] 4.5 Add Discord workflow tests for first and repeated review, concurrent review candidates, no review-time requester ping, reviewer mention without leader assignment, stale controls, refresh replacing retired controls and ineligible selector options on the same canonical message, planned corrections, activation on the same message, partial delivery failure, planned/active message recovery, and independent actions and deletion recovery across several simultaneous raid-detail messages.
- [x] 4.6 Retain regression coverage for automatic grouping throughput, Priority and Ordinary ordering, game-mode isolation and visibility, Icebreaker capacity, other map capacities, and active raid results and postponement.

## 5. Performance evidence, documentation, and delivery

- [x] 5.1 Replace the combined raid-start benchmark path with separate planned-review and streamer-led call-and-start operations at every existing 10x local seeded size through 100,000 requests.
- [x] 5.2 Regenerate the benchmark report with latency and D1 rows read and written for both operations, compare it with the prior baseline, and resolve any material regression before release.
- [x] 5.3 Update ASD-STE100 public and operator documentation to describe review, pre-call correction, `Call and start raid`, leader assignment, call timing, and the unchanged automatic grouping and requester limits.
- [x] 5.4 Run formatting, lint, type checking, static analysis, dead-code analysis, tests, strict OpenSpec validation, migration checksum verification, local benchmarks, and diff checks.
- [x] 5.5 Deploy the verified change to the development environment and smoke-test an automatically grouped review with no calls, a pre-call requester correction, streamer-led start, volunteer-led start, reserved-leader restriction, and compatibility with an existing active detail message.
