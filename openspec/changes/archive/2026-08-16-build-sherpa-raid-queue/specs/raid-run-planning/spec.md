## ADDED Requirements

### Requirement: Unlimited queue-specific automatic grouping
The system SHALL materialize every waiting request immediately into same-map raid groups of the same queue kind. It SHALL fill the earliest eligible raid with capacity, append another raid when needed, preserve existing memberships, and persist no draft.

#### Scenario: Twitch schedule has no segments
- **WHEN** a request is accepted at any time
- **THEN** it is materialized into a visible ordinary raid without schedule data

#### Scenario: A waiting backlog is materialized
- **WHEN** many waiting requests are ready together
- **THEN** the system reads assignments once and commits raid creation, memberships, and planned request state in one fixed-size D1 batch rather than one database cycle per request

#### Scenario: No request is waiting
- **WHEN** materialization runs in steady state
- **THEN** it checks the waiting-only index and does not read raid groups or memberships

#### Scenario: Full raids have accumulated
- **WHEN** a waiting request needs an existing same-map raid
- **THEN** materialization reads only raids whose trigger-maintained current membership count is below requester capacity

#### Scenario: An open raid cannot accept automatic members
- **WHEN** an active or reserved raid owns the last order key and another request needs a new raid
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
The canonical staff board SHALL display at most the first three outstanding priority raids and first seven outstanding ordinary raids using independent stable queries with `LIMIT 3` and `LIMIT 7`. Each section SHALL say `Showing X of Y raids (up to N).` The board SHALL NOT show an additional help-request or outstanding-raid counter and SHALL NOT use `OFFSET`, page state, navigation, or unused-limit borrowing.

#### Scenario: More raids exist than both limits
- **WHEN** four priority and eight ordinary raids are outstanding
- **THEN** the board reports that it shows three of four priority and seven of eight ordinary raids

#### Scenario: Priority queue is empty
- **WHEN** more than seven ordinary raids and no priority raids are outstanding
- **THEN** the board still renders at most seven ordinary raids

### Requirement: One-step raid start and calls
The board SHALL offer one planned-raid selector for both visible queues, listing priority first. Selecting a raid SHALL assign the authorized caller as leader, activate attempt one, send a Discord call, conditionally send a streamer-led Twitch call, and create one persistent detailed staff message.

#### Scenario: Streamer starts without schedule data
- **WHEN** the streamer selects a raid
- **THEN** Discord and Twitch calls are requested without a schedule check

#### Scenario: Volunteer starts a raid
- **WHEN** a volunteer selects a planned raid
- **THEN** Discord is called, Twitch is marked `not_requested`, and the volunteer is pinged on the raid message

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
The persistent raid message SHALL show full participants, goals, notes, leader, calls, and attempt state. Only its leader and configured streamer SHALL operate it. Its controls SHALL record a result, postpone or remove one requester, or postpone the whole raid. Every update SHALL retain the visible leader tag without sending another notification.

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
- **THEN** only current completed memberships close their requests and the postponed request stays active in its dedicated raid

### Requirement: Individual postponement creates the next same-queue raid
Postponing a requester SHALL remove that requester from the active raid and create a dedicated same-map raid immediately after it in the same queue. The source seat SHALL remain empty. The dedicated raid SHALL reserve the same leader, start at attempt zero, and reject automatic filling.

#### Scenario: Last requester is postponed
- **WHEN** the source raid has no remaining requester
- **THEN** the source becomes `not_run`, its obsolete message is deleted, and the dedicated raid takes its queue position

#### Scenario: Dedicated raid creation fails
- **WHEN** any source, ordering, dedicated-raid, or membership write fails
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
