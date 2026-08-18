## MODIFIED Requirements

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

### Requirement: Raid-specific progressive disclosure
The persistent raid message SHALL show game mode, map, full participants, goals, notes, leader, calls, and attempt state. Only its leader and configured streamer SHALL operate it. Its controls SHALL record a result, postpone or remove one requester, or postpone the whole raid. Every update SHALL retain the visible leader tag without sending another notification.

#### Scenario: Raid details are opened
- **WHEN** an authorized leader starts a raid
- **THEN** its persistent message identifies the mode and map before the participant-specific details

#### Scenario: Non-leader volunteer uses a raid control
- **WHEN** another volunteer selects a control
- **THEN** the state remains unchanged and that caller receives a private denial

### Requirement: Individual postponement creates or reuses the next same-queue raid
Postponing a requester SHALL remove that requester from the active raid and append it to the earliest planned follow-up with the same game mode, map, queue kind, and source that has spare capacity, or create a compatible follow-up immediately after the source's existing follow-up chain. The source seat SHALL remain empty. A follow-up SHALL reserve the same leader, start at attempt zero, accept automatic same-mode and same-map filling from its queue kind, and enforce the map-specific requester capacity.

#### Scenario: Two requesters are postponed from one raid
- **WHEN** a leader postpones two requesters from the same active raid and the first compatible follow-up has capacity
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
