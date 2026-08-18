# Raid Run Planning Specification

## Purpose

Define automatic grouping, stable queues, staff-board operation, raid attempts, and requester transitions.

## Requirements

### Requirement: Unlimited queue-specific automatic grouping
The system SHALL materialize every waiting request immediately into raid groups with the same game mode, map, and queue kind. It SHALL fill the earliest eligible compatible raid with capacity, append another raid when needed, preserve existing memberships, and persist no draft. D1 SHALL reject an open membership whose request and raid differ in game mode, map, or queue kind.

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
- **THEN** materialization reads only compatible raids whose trigger-maintained current membership count is below requester capacity

#### Scenario: Another mode has spare capacity
- **WHEN** a waiting request has the same map and queue kind as an open raid but a different game mode
- **THEN** the request does not join that raid and is assigned to a mode-compatible raid

#### Scenario: Incompatible membership is written directly
- **WHEN** a database write attempts to add an active request to a raid with another mode, map, or queue kind
- **THEN** D1 rejects the write without changing membership state

#### Scenario: An open raid cannot accept automatic members
- **WHEN** an active or reserved raid owns the last order key and another request needs a new compatible raid
- **THEN** the new raid appends after every open raid without an order-key collision

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

Each section SHALL use bounded per-mode queries, apply its limit after the mode-presence merge, and say `Showing X of Y raids (up to N).` The board SHALL NOT show an additional help-request or outstanding-raid counter and SHALL NOT use `OFFSET`, page state, navigation, unused-limit borrowing, proportional quotas, or round-robin balancing. Every displayed raid SHALL identify its mode and map.

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

### Requirement: One-step raid start and calls
The board SHALL offer one planned-raid selector for both visible queues, listing Priority first and identifying each option by game mode and map. Selecting a raid SHALL assign the authorized caller as leader, activate attempt one, send a Discord call that identifies the mode and map, conditionally send a streamer-led Twitch call that identifies the mode and map, and create one persistent detailed staff message.

#### Scenario: Streamer starts without schedule data
- **WHEN** the streamer selects a raid
- **THEN** Discord and Twitch calls naming its mode and map are requested without a schedule check

#### Scenario: Volunteer starts a raid
- **WHEN** a volunteer selects a planned raid
- **THEN** Discord is called with its mode and map, Twitch is marked `not_requested`, and the volunteer is pinged on the raid message

### Requirement: Visible active raid details recover from deletion
`/board` and `Refresh` SHALL reconcile only visible active raid-detail messages in background work. A successful Discord read SHALL retain the stored message identity. A confirmed `404` SHALL atomically clear the identity and create one replacement from current D1 state without changing raid or request state and without pinging users. A non-404 Discord failure SHALL retain the identity and SHALL NOT create a replacement. Planned raids SHALL NOT display detail links.

#### Scenario: Active detail message was deleted
- **WHEN** Discord confirms that a visible active raid's stored detail message is missing
- **THEN** one replacement is linked from the canonical board with the same raid, members, leader, calls, and attempt count

#### Scenario: Replacement cannot be created
- **WHEN** the stored message is confirmed missing and Discord rejects replacement creation
- **THEN** the stored identity remains empty, the canonical board omits the dead link, and a later refresh may retry

#### Scenario: Refreshes overlap
- **WHEN** concurrent refreshes create replacement candidates for the same active raid
- **THEN** D1 compare-and-set retains one message identity and the losing duplicate is deleted

### Requirement: Raid-specific progressive disclosure
The persistent raid message SHALL show game mode, map, full participants, goals, notes, leader, calls, and attempt state. Only its leader and configured streamer SHALL operate it. Its controls SHALL record a result, postpone or remove one requester, or postpone the whole raid. Every update SHALL retain the visible leader tag without sending another notification.

#### Scenario: Raid details are opened
- **WHEN** an authorized leader starts a raid
- **THEN** its persistent message identifies the mode and map before the participant-specific details

#### Scenario: Non-leader volunteer uses a raid control
- **WHEN** another volunteer selects a control
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
Postponing a requester SHALL remove that requester from the active raid and append it to the earliest planned follow-up with the same game mode, map, queue kind, and source that has spare capacity, or create a compatible follow-up immediately after the source's existing follow-up chain. The source seat SHALL remain empty. A follow-up SHALL reserve the same leader, start at attempt zero, accept automatic same-mode and same-map filling from its queue kind, and enforce the map-specific requester capacity.

#### Scenario: Two requesters are postponed from one raid
- **WHEN** a leader postpones two requesters from the same active raid and the first follow-up has capacity
- **THEN** both requesters remain planned as members of that one follow-up raid

#### Scenario: Last requester is postponed
- **WHEN** the source raid has no remaining requester
- **THEN** the source becomes `not_run`, its obsolete message is deleted, and the fillable compatible follow-up takes its queue position when no earlier follow-up exists

#### Scenario: Follow-up in another mode has capacity
- **WHEN** another planned follow-up has the same map and queue kind but a different game mode
- **THEN** the postponed requester is not assigned to that follow-up

#### Scenario: Existing compatible follow-up is full
- **WHEN** another requester is postponed and every compatible follow-up for the source is full
- **THEN** a new compatible fillable follow-up is created after the existing follow-up chain without exceeding map capacity

#### Scenario: Follow-up reuse or creation fails
- **WHEN** any source, ordering, destination, or membership write fails
- **THEN** the active source and requester membership remain unchanged

### Requirement: Requester removal is permanent
Removing a requester SHALL cancel that help request and remove its active membership. The request SHALL NOT be rematerialized. A source raid with remaining requesters SHALL stay active. An empty source SHALL become `not_run` and its obsolete message SHALL be deleted.

#### Scenario: Last requester is removed
- **WHEN** the leader removes the only remaining requester
- **THEN** the request is canceled, the raid leaves the board, and its raid message is deleted

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
- **THEN** no state action is required and no new raid starts until staff selects one
