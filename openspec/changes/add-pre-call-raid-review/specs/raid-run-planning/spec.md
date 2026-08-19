## RENAMED Requirements

- FROM: `### Requirement: One-step raid start and calls`
- TO: `### Requirement: Manual raid review and start`
- FROM: `### Requirement: Visible active raid details recover from deletion`
- TO: `### Requirement: Visible raid details recover from deletion`

## MODIFIED Requirements

### Requirement: Unlimited queue-specific automatic grouping
The system SHALL materialize every waiting request immediately into planned draft raid groups with the same game mode, map, and queue kind. It SHALL fill the earliest eligible compatible unreviewed raid with capacity, append another raid when needed, preserve existing memberships, and persist no separate grouping state. D1 SHALL reject an open membership whose request and raid differ in game mode, map, or queue kind.

Opening a raid for review SHALL atomically disable further automatic filling for that raid before its reviewed membership is displayed. A later compatible request SHALL enter another eligible raid and SHALL NOT change a reviewed party silently. Existing requester-capacity and map-capacity limits SHALL remain unchanged.

#### Scenario: Twitch schedule has no segments
- **WHEN** a request is accepted at any time
- **THEN** it is materialized into a visible ordinary raid without schedule data

#### Scenario: A waiting backlog is materialized
- **WHEN** many waiting requests are ready together
- **THEN** the system reads assignments once and commits mode-compatible raid creation, memberships, and planned request state in one fixed-size D1 batch rather than one database cycle per request

#### Scenario: No request is waiting
- **WHEN** materialization runs in steady state
- **THEN** it checks the waiting-only index and does not read raid groups or memberships

#### Scenario: Full raids have accumulated
- **WHEN** a waiting request needs an existing same-mode and same-map raid
- **THEN** materialization reads only compatible unreviewed raids whose trigger-maintained current membership count is below requester capacity

#### Scenario: Another mode has spare capacity
- **WHEN** a waiting request has the same map and queue kind as an open raid but a different game mode
- **THEN** the request does not join that raid and is assigned to a mode-compatible raid

#### Scenario: Incompatible membership is written directly
- **WHEN** a database write attempts to add an active request to a raid with another mode, map, or queue kind
- **THEN** D1 rejects the write without changing membership state

#### Scenario: An open raid cannot accept automatic members
- **WHEN** an active or reviewed raid owns the last order key and another request needs a new compatible raid
- **THEN** the new raid appends after every open raid without an order-key collision

#### Scenario: Matching request arrives after review opens
- **WHEN** staff open a planned raid for review and a later request has the same queue kind, mode, and map
- **THEN** the reviewed raid keeps its displayed membership and the later request enters another compatible planned raid

### Requirement: Manual raid review and start
The board SHALL offer one `Review a raid` selector for planned raids in both visible queues, listing Priority first and identifying each option by game mode and map. Selecting a raid SHALL freeze its current membership and create or reuse one persistent detailed staff message without assigning a leader, changing its planned state or attempt zero, or requesting a Discord or Twitch call. The first newly created review message SHALL mention the selecting staff member for notification while stating that no leader is assigned and no requesters have been called; that mention SHALL NOT reserve leadership.

Using `Refresh` SHALL update the canonical board message in place with the complete board payload rendered from the current D1 snapshot. The update SHALL replace all existing component rows with current-version controls, remove retired controls, and remove selector options for raids that are no longer eligible for review.

The planned detail message SHALL expose `Call and start raid`. Its first eligible successful caller SHALL become leader, activate attempt one, send a Discord call that identifies the mode and map, conditionally send the existing streamer-led Twitch call, and update the same detail message to its active controls. Calls SHALL include only current raid members. An unreserved reviewed raid MAY be started by the configured streamer or any eligible volunteer. A raid with an existing reserved leader SHALL retain the reserved-leader-or-streamer start restriction.

#### Scenario: Staff reviews an automatically grouped raid
- **WHEN** eligible staff select a planned raid from the board
- **THEN** one detailed message shows its current requesters, the raid stays planned at attempt zero, no leader is assigned, and both platform calls remain not requested

#### Scenario: Two staff review the same raid concurrently
- **WHEN** concurrent review actions create message candidates for one planned raid
- **THEN** D1 retains one detail-message identity, every losing duplicate is deleted, and later reviewers receive the retained message link

#### Scenario: Staff refresh a board with stale controls
- **WHEN** eligible staff use `Refresh` after the board state or component contract has changed
- **THEN** the same canonical message is updated with current data and a fully replaced set of current-version controls

#### Scenario: Streamer confirms the reviewed party
- **WHEN** the configured streamer clicks `Call and start raid` on a current planned review
- **THEN** the streamer becomes leader, attempt one becomes active, and Discord and Twitch calls are requested for only the current members

#### Scenario: Volunteer confirms the reviewed party
- **WHEN** an eligible volunteer clicks `Call and start raid` on an unreserved planned review
- **THEN** that volunteer becomes leader, attempt one becomes active, Discord is called for the current members, and Twitch is marked not requested

#### Scenario: Competing staff confirm the same party
- **WHEN** two eligible staff members attempt to call and start one planned raid
- **THEN** exactly one planned-to-active transition succeeds, its caller becomes leader, and the losing action sends no requester call

#### Scenario: Reserved follow-up is reviewed by another volunteer
- **WHEN** a volunteer other than the retained leader attempts to call and start a reserved postponed raid
- **THEN** the raid remains planned and the caller receives a private denial

### Requirement: Visible raid details recover from deletion
`/board` and `Refresh` SHALL reconcile visible reviewed planned and active raid-detail messages in background work. A reviewed planned raid with a retained message SHALL expose a board link without displaying full request text on the canonical board. A successful Discord read SHALL retain the stored message identity. A confirmed `404` SHALL atomically clear the identity and create one replacement from current D1 state without changing raid or request state, assigning a leader, starting an attempt, or pinging requesters. A non-404 Discord failure SHALL retain the identity and SHALL NOT create a replacement. Unreviewed planned raids SHALL NOT display detail links.

#### Scenario: Reviewed planned detail message was deleted
- **WHEN** Discord confirms that a visible reviewed planned raid's stored message is missing
- **THEN** one replacement is linked from the canonical board with the same planned members, no leader, attempt zero, and calls not requested

#### Scenario: Active detail message was deleted
- **WHEN** Discord confirms that a visible active raid's stored detail message is missing
- **THEN** one replacement is linked from the canonical board with the same raid, members, leader, calls, and attempt count

#### Scenario: Replacement cannot be created
- **WHEN** the stored identity is confirmed missing and Discord rejects replacement creation
- **THEN** the stored identity remains empty, the canonical board omits the dead link, and a later refresh may retry

#### Scenario: Refreshes overlap
- **WHEN** concurrent refreshes create replacement candidates for the same reviewed or active raid
- **THEN** D1 compare-and-set retains one message identity and the losing duplicate is deleted

#### Scenario: Several raid details are visible together
- **WHEN** several reviewed or active raids have detail messages and one message is deleted or receives an action
- **THEN** every message identity and action remains scoped to its raid, only the confirmed missing message is recreated, and unrelated raids and messages remain unchanged

### Requirement: Raid-specific progressive disclosure
The canonical board SHALL remain a high-level bounded raid overview and SHALL NOT attempt to display complete requester goals or notes. A reviewed or active persistent raid message SHALL show game mode, map, full participants, goals, notes, leader state, call state, and attempt state.

Before activation, the message SHALL state that no requesters have been called and SHALL allow the configured streamer or any eligible volunteer to select `Call and start raid`, move one requester to the next raid, or remove one requester. It SHALL NOT expose attempt results or whole-raid postponement. After activation, only its leader and configured streamer SHALL operate the existing result, requester-postponement, requester-removal, and whole-raid-postponement controls. Every update SHALL retain the visible leader tag without sending another leader notification.

#### Scenario: Planned raid details are opened
- **WHEN** authorized staff review a planned raid
- **THEN** its persistent message shows complete participant goals and notes, attempt zero, no assigned leader unless already reserved, and no requested calls

#### Scenario: Reviewed party is corrected before calls
- **WHEN** authorized staff move or remove a requester from a planned review
- **THEN** the detail message refreshes with the remaining current members and no requester call is sent

#### Scenario: Raid becomes active
- **WHEN** `Call and start raid` succeeds
- **THEN** the same persistent message shows the assigned leader, attempt one, call statuses, and active raid controls without another call button

#### Scenario: Non-leader volunteer uses an active raid control
- **WHEN** another volunteer selects a control after the raid becomes active
- **THEN** the state remains unchanged and that caller receives a private denial

### Requirement: Individual postponement creates or reuses the next same-queue raid
Moving or postponing a requester SHALL remove that requester from its reviewed planned or active source raid and append it to the earliest planned follow-up with the same game mode, map, queue kind, and source that has spare capacity, or create a compatible follow-up immediately after the source's existing follow-up chain. The source seat SHALL remain empty. A follow-up SHALL retain the source leader only when one is assigned, start at attempt zero, accept automatic same-mode and same-map filling from its queue kind, and enforce the map-specific requester capacity.

A reviewed planned source with remaining members SHALL remain planned, frozen from automatic filling, at attempt zero with calls not requested. An active source with remaining members SHALL retain its active attempt and calls. Emptying either source SHALL close it, clear its stored message identity, and delete the obsolete detail message.

#### Scenario: Two requesters are moved from one reviewed raid
- **WHEN** staff move two requesters before calls and the first compatible follow-up has capacity
- **THEN** both requesters remain planned as members of that one follow-up raid and neither receives a call

#### Scenario: Two requesters are postponed from one active raid
- **WHEN** a leader postpones two requesters from the same active raid and the first follow-up has capacity
- **THEN** both requesters remain planned as members of that one follow-up raid

#### Scenario: Last requester leaves the source
- **WHEN** movement or postponement leaves the reviewed or active source with no requester
- **THEN** the source becomes `not_run`, its obsolete message is deleted, and the fillable compatible follow-up takes its queue position when no earlier follow-up exists

#### Scenario: Follow-up in another mode has capacity
- **WHEN** another planned follow-up has the same map and queue kind but a different game mode
- **THEN** the moved requester is not assigned to that follow-up

#### Scenario: Existing compatible follow-up is full
- **WHEN** another requester is moved and every compatible follow-up for the source is full
- **THEN** a new compatible fillable follow-up is created after the existing follow-up chain without exceeding map capacity

#### Scenario: Follow-up reuse or creation fails
- **WHEN** any source, ordering, destination, or membership write fails
- **THEN** the source and requester membership remain unchanged

### Requirement: Requester removal is permanent
Removing a requester from a reviewed planned or active raid SHALL cancel that help request and remove its active membership. The request SHALL NOT be rematerialized. A source raid with remaining requesters SHALL retain its current planned-review or active state. An empty source SHALL become `not_run`, clear its stored message identity, and delete its obsolete detail message. Removal from a planned review SHALL NOT assign a leader, begin an attempt, or send a call.

#### Scenario: Planned requester is removed before calls
- **WHEN** authorized staff remove one requester from a reviewed planned raid that retains another requester
- **THEN** the request is canceled, the reviewed raid remains planned with its remaining members, and no call is sent

#### Scenario: Last requester is removed
- **WHEN** authorized staff remove the only remaining requester from a reviewed or active raid
- **THEN** the request is canceled, the raid leaves the board, and its detail message is deleted

### Requirement: No manual or automatic session state
The board SHALL NOT expose Pause, Resume, End Night, leader reassignment, requester assignment, pagination, or board-level result controls. Time and schedule data SHALL NOT change request or raid state.

#### Scenario: Streamer stops raids
- **WHEN** the streamer wants to stop work
- **THEN** no state action is required and no new raid starts until eligible staff explicitly select `Call and start raid`
