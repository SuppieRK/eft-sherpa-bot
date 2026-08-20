# Raid Run Planning Specification

## Purpose

Define automatic grouping, stable queues, staff-board operation, raid attempts, and requester transitions.
## Requirements
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

### Requirement: Stable ordinary and priority queues
New requests SHALL enter the ordinary queue. Whole-raid postponement SHALL move the same raid to the end of the priority queue. Each queue SHALL preserve FIFO raid order, and automatic filling SHALL NOT move members between queue kinds.

#### Scenario: Priority group is postponed again
- **WHEN** an existing priority raid selects `Postpone raid`
- **THEN** the same raid moves after earlier outstanding priority raids

### Requirement: One leader and bounded capacity
Each started raid SHALL have one leader who is the configured streamer or eligible volunteer. Requester capacity SHALL be `min(3, map party capacity - 1)`.

The disposable D1 baseline SHALL accept only committed map identifiers and SHALL reject a stored requester capacity above `map party capacity - 1`. Standard five-person maps SHALL accept at most four requesters and three-person Icebreaker SHALL accept at most two. Membership insert and move triggers SHALL enforce the stored validated capacity.

#### Scenario: Volunteer claims a raid
- **WHEN** an eligible volunteer starts an ordinary or priority planned raid
- **THEN** the volunteer becomes leader and the raid can proceed without the streamer

#### Scenario: Runtime recipient limit exceeds a map party
- **WHEN** grouping runs with a recipient limit above the selected map's physical capacity
- **THEN** it creates raids with no more than `map party capacity - 1` requesters and D1 rejects any later membership overflow

### Requirement: Split canonical board windows
The canonical staff board SHALL display at most three outstanding Priority raids and seven outstanding Ordinary raids. Within each section, it SHALL reserve at least one visible raid for each non-empty game mode by selecting the oldest outstanding raid from every non-empty mode, ordering those heads by stable raid order, and filling remaining visible slots from all unselected raids in stable FIFO order. FIFO order within each mode SHALL remain stable.

Each section SHALL use bounded per-mode queries, apply its limit after the mode-presence merge, and say `Showing X of Y raids (up to N).` The board SHALL NOT show an additional help-request or outstanding-raid counter and SHALL NOT use `OFFSET`, page state, navigation, unused-limit borrowing, proportional quotas, or round-robin balancing. Every displayed raid SHALL identify its mode and map, list every current requester by Twitch login, and omit the leader-inclusive party-occupancy fraction. Complete requester goals and notes SHALL remain in the raid-specific detail message.

#### Scenario: More raids exist than both limits
- **WHEN** four Priority and eight Ordinary raids are outstanding across one or more modes
- **THEN** the board reports that it shows three of four Priority and seven of eight Ordinary raids

#### Scenario: Ordinary demand is skewed across two modes
- **WHEN** one mode has at least seven older Ordinary raids and another mode has one Ordinary raid
- **THEN** the board shows the minority mode's oldest raid and up to six raids from the dominant mode

#### Scenario: All three modes have ordinary work
- **WHEN** PvP Seasonal, PvP, and PvE each have at least one outstanding Ordinary raid
- **THEN** at least one raid from each mode is present in the seven visible Ordinary raids

#### Scenario: One mode has all ordinary work
- **WHEN** more than seven Ordinary raids exist in one mode and no other mode has an outstanding Ordinary raid
- **THEN** the board shows the first seven raids from that mode in stable order

#### Scenario: Priority queue is empty
- **WHEN** more than seven Ordinary raids and no Priority raids are outstanding
- **THEN** the board still renders at most seven Ordinary raids

#### Scenario: One requester is waiting for a planned raid
- **WHEN** the canonical board renders a planned Woods raid containing only Twitch requester `chosen` and no assigned leader
- **THEN** the raid summary says `Requesters: @chosen`, does not show a party-occupancy fraction, and continues to say that the leader is assigned when called

#### Scenario: Several requesters are grouped
- **WHEN** the canonical board renders a raid containing several current requesters
- **THEN** the raid summary lists every requester's Twitch login while objectives and notes remain available only in raid details

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

### Requirement: Configurable attempt workflow
Starting SHALL set attempt one. Before the configured limit, `Record unsuccessful attempt` SHALL increment the counter without another call. On the final attempt the result choices SHALL be `Helped` and `Postpone raid`. The system SHALL NOT store or expose a Try Again outcome.

#### Scenario: Helped is recorded
- **WHEN** the leader selects `Helped`
- **THEN** the raid and its requests complete, its stored detail-message identity is cleared, and its obsolete detail message is deleted

#### Scenario: Final unresolved raid is postponed
- **WHEN** the leader selects `Postpone raid` on the final attempt
- **THEN** the same raid and memberships move to the end of Priority with reset attempts and the old detail message is cleared and deleted

#### Scenario: Terminal message deletion fails
- **WHEN** `Helped` or `Postpone raid` commits but Discord rejects deletion of the old detail message
- **THEN** the durable transition remains, the stored message identity remains cleared, the old controls cannot repeat it, and the leader receives a private warning

#### Scenario: A source contains historical removed membership
- **WHEN** `Helped` completes a raid after one requester was postponed out of it
- **THEN** only current completed memberships close their requests and the postponed request stays active in its follow-up raid

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

### Requirement: Whole-raid postponement moves to priority
`Postpone raid` SHALL be an option in the raid-result selector. It SHALL move the same remaining group to the end of the priority queue, return it to planned state, reset attempts to zero and calls to not requested, retain the leader reservation, reject automatic filling, clear its old message identity, and delete the old message. It SHALL NOT send another call until the raid is started again.

#### Scenario: Ordinary raid is postponed
- **WHEN** the assigned leader postpones an active ordinary raid
- **THEN** its remaining requests stay active together in a planned raid after all existing priority raids

#### Scenario: Priority raid is postponed again
- **WHEN** the assigned leader postpones an active priority raid
- **THEN** the same raid moves to the end of the priority queue with attempt zero and the same reserved leader

### Requirement: No manual or automatic session state
The board SHALL NOT expose Pause, Resume, End Night, leader reassignment, requester assignment, pagination, or board-level result controls. Time and schedule data SHALL NOT change request or raid state.

#### Scenario: Streamer stops raids
- **WHEN** the streamer wants to stop work
- **THEN** no state action is required and no new raid starts until eligible staff explicitly select `Call and start raid`

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

### Requirement: Staff can pull one requester into a reviewed raid
A reviewed planned raid with requester capacity SHALL expose a `Pull requester up` select menu directly in its raid detail message. When the first eligible later source exists, the menu SHALL list every current requester in that source with Twitch identity and goal. When no eligible source exists, the menu SHALL remain visible but disabled and SHALL state that no compatible requester is available. The source SHALL have the same game mode and map and SHALL be planned, unreviewed, automatically fillable, unreserved, and later in service order. An Ordinary destination SHALL search only later Ordinary raids. A Priority destination SHALL search later Priority raids before Ordinary raids. The system SHALL NOT list an active, reviewed, or leader-reserved source.

Selecting one listed requester SHALL atomically append that requester to the reviewed destination without exceeding requester capacity. It SHALL retain the destination's planned state, attempt count, leader reservation, automatic-fill state, and call statuses. It SHALL send no Discord or Twitch requester call. The reviewed detail message and canonical board SHALL refresh from the committed state.

#### Scenario: Ordinary reviewed raid has an open seat
- **WHEN** eligible staff request pull candidates and the first later unreviewed Ordinary raid has the same game mode and map
- **THEN** the raid review message contains a `Pull requester up` selector that lists every current requester in that one source raid with Twitch identity and goal

#### Scenario: No eligible source exists
- **WHEN** a reviewed raid has requester capacity but no eligible later source
- **THEN** its raid review message contains a disabled `Pull requester up` selector that states `No compatible requester available`

#### Scenario: Earlier later raid is incompatible
- **WHEN** a later raid has another game mode or map before an eligible source
- **THEN** source discovery skips the incompatible raid without exposing its requesters

#### Scenario: Source is not safe to modify
- **WHEN** the next same-mode and same-map raid is active, reviewed, or leader-reserved
- **THEN** its requesters are not offered as pull candidates and no membership changes

#### Scenario: Selected requester is pulled
- **WHEN** authorized staff select a current source requester while the reviewed destination still has capacity
- **THEN** that requester becomes a current member of the destination, all other source requesters remain active, no attempt starts, and no call is sent

#### Scenario: Selection becomes stale
- **WHEN** the destination fills, the source changes state, or the selected requester moves before the selection commits
- **THEN** the entire transition is rejected without changing a request, membership, raid, call, or attempt

### Requirement: Deleted planned raid review details are dismissed
A board Refresh or repeat Review action for a frozen planned raid SHALL update its stored Discord detail message with current controls. When Discord reports that the planned detail message does not exist, the system SHALL atomically clear the stale reference, SHALL NOT create a replacement, and SHALL refresh the canonical board without a details link. It SHALL NOT assign a leader, start an attempt, or send a call. A later explicit Review action MAY create a fresh detail message.

#### Scenario: Staff review a raid after deleting its details
- **WHEN** the stored raid detail message returns Discord `404` and staff select that raid from `Review a raid` again
- **THEN** the bot clears the stale link, does not create a message, and tells staff that the deleted review returned to the board

#### Scenario: Board refresh finds a deleted reviewed detail
- **WHEN** a visible reviewed raid points to a Discord detail message that was manually deleted
- **THEN** Refresh clears the stale link without creating a message or changing request, attempt, leader, or call state

### Requirement: Deleted active raid details recover
When Refresh finds that an active raid detail message does not exist, the system SHALL create one replacement with current result and requester controls and atomically replace the stale reference. Concurrent recovery SHALL retain only one canonical replacement. A non-404 Discord failure SHALL retain the existing identity and SHALL NOT create a replacement.

#### Scenario: Board refresh finds a deleted active detail
- **WHEN** an active raid points to a Discord detail message that was manually deleted
- **THEN** Refresh creates one replacement and updates the board link without changing the attempt, leader, or call state

#### Scenario: Replacement cannot be created
- **WHEN** an active raid's stored identity is confirmed missing and Discord rejects replacement creation
- **THEN** the stored identity remains empty, the canonical board omits the dead link, and a later refresh may retry

#### Scenario: Refreshes overlap
- **WHEN** concurrent refreshes create replacement candidates for the same active raid
- **THEN** D1 compare-and-set retains one message identity and the losing duplicate is deleted

#### Scenario: Several raid details are visible together
- **WHEN** several reviewed or active raids have detail messages and one message is deleted or receives an action
- **THEN** every message identity and action remains scoped to its raid, only a missing active message is recreated, a missing planned-review link is cleared, and unrelated raids and messages remain unchanged

### Requirement: Staff can cancel a planned raid review
A frozen planned raid detail message SHALL expose a secondary `Cancel review` button in the same action row immediately after `Call and start raid`. When authorized staff select it from the canonical detail message, the system SHALL atomically clear that exact stored message reference, delete the Discord message, and refresh the canonical board without a details link. It SHALL retain the planned frozen raid, queue kind, stable order, leader reservation, attempt count, call state, memberships, and help requests. A later explicit Review action MAY create new details.

The system SHALL reject a stale or duplicate message, an unreviewed raid, and an active or terminal raid without deleting its current details or changing raid state. A Discord `404` SHALL count as a successful deletion. If another Discord deletion error occurs after the reference clears, the system SHALL attempt to restore the same reference and SHALL tell staff to retry. Active raid details SHALL NOT expose `Cancel review`.

#### Scenario: Staff cancel a planned review
- **WHEN** authorized staff select `Cancel review` on the canonical details for a frozen planned raid
- **THEN** the details message is deleted, its stored link is cleared, and the unchanged raid remains available on the board

#### Scenario: Staff use a stale Cancel review control
- **WHEN** a Cancel review interaction comes from a message that is no longer the raid's canonical planned detail
- **THEN** the system rejects it without deleting a message or changing the stored link or raid

#### Scenario: Raid starts before cancellation commits
- **WHEN** the raid becomes active before the planned-review dismissal update commits
- **THEN** cancellation is rejected and the active detail message and raid state remain unchanged

#### Scenario: Discord cannot delete the review
- **WHEN** the planned reference clears but Discord returns an error other than `404` for message deletion
- **THEN** the system attempts to restore the same reference, makes no raid-state change, and tells staff to retry

### Requirement: Priority pull explicitly promotes one Ordinary request
A reviewed Priority raid MAY pull a selected requester from the first eligible Ordinary source when no eligible later Priority source precedes it. The transaction SHALL promote only the selected help request to Priority before creating its compatible Priority membership. Every other source request SHALL remain Ordinary. Any push-down after that pull SHALL use only an Ordinary destination. An Ordinary raid SHALL NOT pull a Priority requester.

#### Scenario: Postponed Priority raid pulls from Ordinary
- **WHEN** authorized staff select an Ordinary requester with the same game mode and map for a reviewed postponed Priority raid with capacity
- **THEN** only the selected request and its new membership become Priority while the source remainder stays Ordinary

#### Scenario: Later Priority source exists
- **WHEN** a reviewed Priority destination has an eligible later Priority source before the first eligible Ordinary source
- **THEN** the selector uses the Priority source and does not expose the Ordinary source

#### Scenario: Ordinary destination requests candidates
- **WHEN** staff use `Pull requester up` on an Ordinary reviewed raid
- **THEN** the selector does not expose any Priority requester

### Requirement: Pull attempts one bounded push-down
After a pull removes the selected requester from its source, the same atomic transition SHALL examine the source remainder. If no requester remains, the source SHALL close as not run. Otherwise, the system SHALL consider only the immediately following planned, unreviewed, automatically fillable, unreserved raid in the source queue with the same game mode and map. If that one raid has capacity for the complete remainder, every remaining source requester SHALL move together into it in stable source order and the empty source SHALL close as not run. If the complete remainder does not fit or no eligible immediate raid exists, no remainder member SHALL move and the source SHALL remain planned.

Push-down SHALL NOT cross queue kinds, game modes, or maps; split the remainder; continue into another raid; assign or change a leader; start an attempt; or send a call. Every membership move and source closure SHALL be committed atomically with the selected pull and enforced by D1 compatibility and capacity constraints.

#### Scenario: Complete remainder fits in the next raid
- **WHEN** one requester is pulled and the immediately following eligible compatible raid can accept every requester left in the source
- **THEN** the complete remainder moves into that raid, the source closes, and no later raid changes

#### Scenario: Source becomes empty from the pull
- **WHEN** the selected requester was the source's only current member
- **THEN** the source closes without a push-down lookup changing another membership

#### Scenario: Complete remainder does not fit
- **WHEN** the immediate eligible compatible raid has insufficient capacity for all source requesters left after the pull
- **THEN** every remaining requester stays together in the planned source and the later raid is unchanged

#### Scenario: Immediate compatible raid is frozen
- **WHEN** the immediately following same-queue, same-mode, and same-map raid is reviewed or leader-reserved
- **THEN** push-down stops, the source remainder stays in place, and no farther raid is searched

#### Scenario: Ordinary source follows a Priority destination
- **WHEN** a selected Ordinary requester moves into Priority and the complete Ordinary source remainder fits in its immediate eligible Ordinary successor
- **THEN** the remainder moves only within Ordinary, the selected request stays Priority, and the source closes

#### Scenario: Push write fails
- **WHEN** any request, membership, capacity, source closure, or push-target write fails
- **THEN** the selected pull and every optional push-down mutation roll back together

### Requirement: Raid calls include map entry requirements
The committed Tarkov map catalog SHALL define one mode-independent preparation reminder for each restricted location. The reminder SHALL apply identically to PvP Seasonal, PvP, and PvE and SHALL contain the approved items, fees, and conditions that players must bring for the raid.

The catalog SHALL define these reminders:

- The Lab: each player needs a TerraGroup Labs access keycard.
- The Labyrinth: each player needs a Labrys access keycard, and the party needs one Knossos LLC facility key.
- Terminal: each player needs one accepted access option: a Reprogrammed RFID keycard with Mr. Kerman's hash codes together with the Secure container Alpha-1 with TerraGroup evidence, an RFID keycard with unknown name, a Reprogrammed RFID keycard with Prapor's hash codes, or Prapor's letter for the port checkpoint. Entry is through Shoreline from 21:00 to 06:00.
- Icebreaker: each player needs the current Rouble entry fee and the current Euro exit fee; the reminder SHALL NOT commit numeric amounts.

When `Call and start raid` requests a platform call for a restricted location, the Discord call and any requested Twitch call SHALL append concise `Bring:` guidance derived from that location's catalog entry. Both calls SHALL retain their existing requester identities, Discord mention allowlist, mode and map, delivery rules, and call-status transitions. Calls for all other committed locations SHALL add no preparation-requirement text. Reminders SHALL NOT include extraction items or fees except for Icebreaker's required Euro exit fee, optional room keys, equipment recommendations, or quest objectives.

#### Scenario: Discord calls requesters for The Lab
- **WHEN** eligible staff start a reviewed raid for The Lab in any supported game mode
- **THEN** the Discord call retains its current mentions and tells each player to bring a TerraGroup Labs access keycard

#### Scenario: Twitch calls requesters for The Labyrinth
- **WHEN** the streamer starts a reviewed raid for The Labyrinth and a Twitch call is requested
- **THEN** the Twitch call retains the current requester tags and tells each player to bring a Labrys access keycard and the party to bring one Knossos LLC facility key

#### Scenario: Terminal call lists accepted access options
- **WHEN** a Terminal raid call is sent
- **THEN** it identifies the accepted per-player access alternatives, the combined Mr. Kerman-card and Alpha-1-container option, and the Shoreline 21:00-to-06:00 entry condition

#### Scenario: Icebreaker call covers entry and exit fees
- **WHEN** an Icebreaker raid call is sent
- **THEN** it tells each player to bring the current Rouble entry fee and current Euro exit fee without naming numeric amounts

#### Scenario: Standard map call remains concise
- **WHEN** a raid call is sent for a committed map without an entry requirement
- **THEN** its existing content has no `Bring:` guidance

#### Scenario: Requirement text is identical across modes
- **WHEN** calls are rendered for the same restricted location in PvP Seasonal, PvP, and PvE
- **THEN** every call uses the same catalog entry requirement apart from its existing mode label

#### Scenario: Longest Twitch call remains valid
- **WHEN** the maximum supported requester party has maximum-length valid Twitch logins and the longest entry reminder
- **THEN** the complete Twitch call remains within the platform message-length limit
