# Raid Run Planning Specification

## Purpose

Define automatic grouping, stable service order, staff-board operation, completion, and requester transitions.
## Requirements
### Requirement: New requests are assigned atomically
Every accepted new help request SHALL commit as a planned request with exactly one open membership. The transaction SHALL fill the earliest eligible compatible unreviewed planned raid with capacity or create one new raid at the unified normal tail. Compatibility SHALL require the same game mode and map. The transaction SHALL enforce configured requester capacity and SHALL leave no committed active request without an open membership.

#### Scenario: A compatible raid has capacity
- **WHEN** a valid request matches an automatically fillable planned raid
- **THEN** the transaction adds the requester to that earliest raid at the next contiguous position

#### Scenario: No compatible raid has capacity
- **WHEN** a valid request has no eligible destination
- **THEN** the transaction creates one compatible raid at the unified normal tail and adds the requester to it

#### Scenario: A reviewed or active raid has capacity
- **WHEN** a valid request matches a raid that is reviewed, reserved, or active
- **THEN** automatic intake does not modify that raid and uses another eligible raid or creates one

#### Scenario: Compatible requests arrive concurrently
- **WHEN** concurrent requests target the same mode and map
- **THEN** each request receives one unique contiguous membership without exceeding requester capacity

### Requirement: One leader and bounded capacity
Each started raid SHALL have one leader who is the configured streamer or eligible volunteer. Requester capacity SHALL be `min(configured recipient limit, map party capacity - 1)`.

The disposable D1 baseline SHALL accept only committed map identifiers and SHALL reject a stored requester capacity above `map party capacity - 1`. Standard five-person maps SHALL accept at most four requesters and three-person Icebreaker SHALL accept at most two. Membership insert and move triggers SHALL enforce the stored validated capacity.

#### Scenario: Volunteer claims a raid
- **WHEN** an eligible volunteer starts an planned raid
- **THEN** the volunteer becomes leader and the raid can proceed without the streamer

#### Scenario: Runtime recipient limit exceeds a map party
- **WHEN** grouping runs with a recipient limit above the selected map's physical capacity
- **THEN** it creates raids with no more than `map party capacity - 1` requesters and D1 rejects any later membership overflow

### Requirement: Raid-specific progressive disclosure
The canonical board SHALL remain a high-level bounded raid overview and SHALL NOT attempt to display complete requester goals or notes. A reviewed or active persistent raid message SHALL show game mode, map, full participants, goals, notes, leader state and call state.

Before activation, the message SHALL state that no requesters have been called and SHALL allow the configured streamer or any eligible volunteer to select `Call and start raid`, move one requester to an existing eligible later raid when available, or remove one requester. It SHALL NOT expose results or whole-raid postponement. After activation, only its leader and configured streamer SHALL operate the existing result, requester-postponement, requester-removal, and whole-raid-postponement controls. Every update SHALL retain the visible leader tag without sending another leader notification.

#### Scenario: Planned raid details are opened
- **WHEN** authorized staff review a planned raid
- **THEN** its persistent message shows complete participant goals and notes, no assigned leader unless already reserved, and no requested calls

#### Scenario: Reviewed party is corrected before calls
- **WHEN** authorized staff move or remove a requester from a planned review
- **THEN** the detail message refreshes with the remaining current members and no requester call is sent

#### Scenario: Raid becomes active
- **WHEN** `Call and start raid` succeeds
- **THEN** the same persistent message shows the assigned leader, call statuses, and active raid controls without another call button

#### Scenario: Non-leader volunteer uses an active raid control
- **WHEN** another volunteer selects a control after the raid becomes active
- **THEN** the state remains unchanged and that caller receives a private denial

### Requirement: Reviewed requester movement uses an existing eligible later raid
Moving a requester from a reviewed planned raid SHALL target the first existing unreviewed planned raid after the source in effective service order with the same game mode and map, automatic filling enabled, and spare requester capacity. It SHALL NOT create a raid. Availability SHALL be determined by an indexed capped whole-backlog lookup, independently of board pagination, and hydrated once per selected raid rather than once per member. The movement dropdown SHALL be absent when no destination exists. A submitted stale control SHALL receive private guidance without changing source, request, membership, destination, or board state.

Planned move controls SHALL identify the observed destination and remain distinct from active postponement. Changed destinations, source states, or review identities SHALL invalidate the action. The transaction SHALL revalidate source state, review identity, current membership, and the earliest eligible destination before changing records. The requester SHALL retain its request identity and active status and append after the destination's highest current member position. Destination leadership and capacity SHALL remain unchanged. A source with remaining members SHALL stay planned and frozen with calls not requested. An empty source SHALL close as not run, clear its detail identity, and delete its obsolete message. No move SHALL start a raid or call a requester.

#### Scenario: No compatible later raid exists
- **WHEN** staff review a sole-requester raid with no eligible later destination
- **THEN** the move dropdown is absent and submitting an old move control changes no raid or request

#### Scenario: Destination is beyond the displayed board page
- **WHEN** the first eligible destination exists outside the ten visible raids
- **THEN** the move dropdown remains available and targets that existing raid without creating a replacement

#### Scenario: Destination becomes ineligible before the transaction
- **WHEN** the displayed destination fills, enters review, becomes active, or moves before the source
- **THEN** the guarded transaction rejects the stale selection without partial changes

#### Scenario: Last requester moves to an existing destination
- **WHEN** the source's sole requester moves
- **THEN** the source closes and the existing destination retains its identity, members, leader reservation, and placement

#### Scenario: Storage fails during the move
- **WHEN** a source, membership, destination, or board write fails
- **THEN** the complete move rolls back

### Requirement: Individual postponement creates or reuses the next compatible raid
Postponing an active requester SHALL remove that requester from its active source raid and append it to the earliest planned follow-up with the same game mode, map, and source that has spare capacity, or create a compatible follow-up immediately after the source's existing follow-up chain. The source seat SHALL remain empty. A follow-up SHALL retain the source leader when one is assigned, accept automatic same-mode and same-map filling, and enforce the map-specific requester capacity.

An active source with remaining members SHALL retain its active state and calls. Emptying the source SHALL close it, clear its stored message identity, and delete the obsolete detail message.

#### Scenario: Two requesters are postponed from one active raid
- **WHEN** a leader postpones two requesters from the same active raid and the first follow-up has capacity
- **THEN** both requesters remain planned as members of that one follow-up raid

#### Scenario: Last requester leaves the source
- **WHEN** postponement leaves the active source with no requester
- **THEN** the source becomes not run, its obsolete message is deleted, and the fillable compatible follow-up takes its queue position when no earlier follow-up exists

#### Scenario: Follow-up in another mode has capacity
- **WHEN** another planned follow-up has the same map but a different game mode
- **THEN** the postponed requester is not assigned to that follow-up

#### Scenario: Existing compatible follow-up is full
- **WHEN** another requester is postponed and every compatible follow-up for the source is full
- **THEN** a new compatible fillable follow-up is created after the existing follow-up chain without exceeding map capacity

#### Scenario: Follow-up reuse or creation fails
- **WHEN** any source, ordering, destination, or membership write fails
- **THEN** the source and requester membership remain unchanged

### Requirement: Requester removal is permanent
Removing a requester from a reviewed planned or active raid SHALL cancel that help request and remove its active membership. The request SHALL NOT be rematerialized. A source raid with remaining requesters SHALL retain its current planned-review or active state. An empty source SHALL become `not_run`, clear its stored message identity, and delete its obsolete detail message. Removal from a planned review SHALL NOT assign a leader, start the raid, or send a call.

#### Scenario: Planned requester is removed before calls
- **WHEN** authorized staff remove one requester from a reviewed planned raid that retains another requester
- **THEN** the request is canceled, the reviewed raid remains planned with its remaining members, and no call is sent

#### Scenario: Last requester is removed
- **WHEN** authorized staff remove the only remaining requester from a reviewed or active raid
- **THEN** the request is canceled, the raid leaves the board, and its detail message is deleted

### Requirement: No manual or automatic session state
The board SHALL NOT expose Pause, Resume, End Night, leader reassignment, requester assignment or board-level result controls. Time and schedule data SHALL NOT change request or raid state.

#### Scenario: Streamer stops raids
- **WHEN** the streamer wants to stop work
- **THEN** no state action is required and no new raid starts until eligible staff explicitly select `Call and start raid`

### Requirement: Manual raid review and start
The board SHALL offer one `Review a raid` selector for planned raids on the current page in effective service order and identifying each option by game mode and map. Selecting a raid SHALL freeze its current membership and create or reuse one persistent detailed staff message without assigning a leader, changing its planned state, or requesting a Discord or Twitch call. The first newly created review message SHALL mention the selecting staff member for notification while stating that no leader is assigned and no requesters have been called; that mention SHALL NOT reserve leadership.

Using `Refresh` SHALL update the canonical board message in place with the complete board payload rendered from the current D1 snapshot. The update SHALL replace all existing component rows with current-version controls, remove retired controls, and remove selector options for raids that are no longer eligible for review.

The planned detail message SHALL expose `Call and start raid`. Its first eligible successful caller SHALL become leader, activate the raid, send a Discord call that identifies the mode and map, conditionally send the existing streamer-led Twitch call, and update the same detail message to its active controls. Calls SHALL include only current raid members. An unreserved reviewed raid MAY be started by the configured streamer or any eligible volunteer. A raid with an existing reserved leader SHALL retain the reserved-leader-or-streamer start restriction.

#### Scenario: Staff reviews an automatically grouped raid
- **WHEN** eligible staff select a planned raid from the board
- **THEN** one detailed message shows its current requesters, the raid stays planned at no leader is assigned, and both platform calls remain not requested

#### Scenario: Two staff review the same raid concurrently
- **WHEN** concurrent review actions create message candidates for one planned raid
- **THEN** D1 retains one detail-message identity, every losing duplicate is deleted, and later reviewers receive the retained message link

#### Scenario: Staff refresh a board with stale controls
- **WHEN** eligible staff use `Refresh` after the board state or component contract has changed
- **THEN** the same canonical message is updated with current data and a fully replaced set of current-version controls

#### Scenario: Streamer confirms the reviewed party
- **WHEN** the configured streamer clicks `Call and start raid` on a current planned review
- **THEN** the streamer becomes leader, the raid becomes active, and Discord and Twitch calls are requested for only the current members

#### Scenario: Volunteer confirms the reviewed party
- **WHEN** an eligible volunteer clicks `Call and start raid` on an unreserved planned review
- **THEN** that volunteer becomes leader, the raid becomes active, Discord is called for the current members, and Twitch is marked not requested

#### Scenario: Competing staff confirm the same party
- **WHEN** two eligible staff members attempt to call and start one planned raid
- **THEN** exactly one planned-to-active transition succeeds, its caller becomes leader, and the losing action sends no requester call

#### Scenario: Reserved follow-up is reviewed by another volunteer
- **WHEN** a volunteer other than the retained leader attempts to call and start a reserved postponed raid
- **THEN** the raid remains planned and the caller receives a private denial

### Requirement: Staff can pull one requester into a reviewed or active raid
A reviewed planned or active raid with requester capacity SHALL expose a `Pull requester up` select menu directly in its raid detail message. The source SHALL have the same game mode and map and SHALL be planned with no open review message. The source SHALL be automatically fillable or have a reserved leader. A leader reservation SHALL NOT block a manual pull, including when automatic filling is disabled. Every destination SHALL accept eligible compatible sources, including sources before the destination in service order. The system SHALL NOT list an active source, a source with an open review message, or a frozen source without a reserved leader. Only the assigned leader or streamer SHALL use pull controls on an active destination.

The menu SHALL show every current requester in one source raid with Twitch identity and goal. `Previous source` and `Next source` buttons SHALL make every eligible source reachable in effective service order. Navigation SHALL use bounded indexed lookups and SHALL NOT load the entire queue. When no eligible source exists, the menu SHALL remain visible but disabled and SHALL state that no compatible requester is available. Detail messages SHALL remain within Discord's five action-row limit.

Selecting one listed requester SHALL atomically append that requester to the destination without exceeding requester capacity. It SHALL retain the destination's planned or active state, start time, leader reservation, automatic-fill state, and call statuses. It SHALL send no Discord or Twitch requester call. The detail message and canonical board SHALL refresh from the committed state. Selection SHALL revalidate the selected source itself rather than require it to be the first eligible source.

#### Scenario: Destination starts during selection
- **WHEN** another staff member starts the destination or changes its leader after the caller's access check
- **THEN** the pull transaction rejects the stale selection and leaves all memberships unchanged

#### Scenario: Reviewed raid has an open seat
- **WHEN** eligible staff request pull candidates and an eligible planned raid has the same game mode and map
- **THEN** the raid detail message contains a `Pull requester up` selector with Twitch identity and goal, and navigation makes every eligible source available

#### Scenario: No eligible source exists
- **WHEN** a reviewed or active raid has requester capacity but no eligible source
- **THEN** its raid review message contains a disabled `Pull requester up` selector that states `No compatible requester available`

#### Scenario: Earlier later raid is incompatible
- **WHEN** a later raid has another game mode or map before an eligible source
- **THEN** source discovery skips the incompatible raid without exposing its requesters

#### Scenario: Source is not safe to modify
- **WHEN** the next same-mode and same-map raid is active or has an open review message
- **THEN** its requesters are not offered as pull candidates and no membership changes

#### Scenario: Selected requester is pulled
- **WHEN** authorized staff select a current source requester while the reviewed or active destination still has capacity
- **THEN** that requester becomes a current member of the destination, all other source requesters remain active, no raid starts, and no call is sent

#### Scenario: Two compatible raids have reserved leaders
- **WHEN** staff review one raid and the other planned raid has no open review message
- **THEN** its requesters are eligible for a manual pull even if its automatic filling is disabled
- **AND** any retained source group keeps its leader reservation and automatic-fill setting

#### Scenario: Reserved source still has an open review
- **WHEN** both compatible reserved raids have open review messages
- **THEN** neither can be a pull source until its review closes

#### Scenario: Selection becomes stale
- **WHEN** the destination fills, the source changes state, or the selected requester moves before the selection commits
- **THEN** the entire transition is rejected without changing a request, membership, raid or call

#### Scenario: Active raid accepts a requester
- **WHEN** the assigned leader or streamer selects a compatible requester for an active raid with capacity
- **THEN** the requester joins without resetting the start time, changing the leader, or sending another call

#### Scenario: Another volunteer attempts an active pull
- **WHEN** a volunteer other than the assigned leader uses pull, candidate, or source-navigation controls on an active raid
- **THEN** the bot privately denies the action and changes no memberships

### Requirement: Deleted planned raid review details are dismissed
A board Refresh or repeat Review action for a frozen planned raid SHALL update its stored Discord detail message with current controls. When Discord reports that the planned detail message does not exist, the system SHALL atomically clear the stale reference, SHALL NOT create a replacement, and SHALL refresh the canonical board without a details link. It SHALL NOT assign a leader, start the raid, or send a call. A later explicit Review action MAY create a fresh detail message.

#### Scenario: Staff review a raid after deleting its details
- **WHEN** the stored raid detail message returns Discord `404` and staff select that raid from `Review a raid` again
- **THEN** the bot clears the stale link, does not create a message, and tells staff that the deleted review returned to the board

#### Scenario: Board refresh finds a deleted reviewed detail
- **WHEN** a visible reviewed raid points to a Discord detail message that was manually deleted
- **THEN** Refresh clears the stale link without creating a message or changing request, raid, leader, or call state

### Requirement: Deleted active raid details recover
When Refresh finds that an active raid detail message does not exist, the system SHALL create one replacement with current result and requester controls and atomically replace the stale reference. Concurrent recovery SHALL retain only one canonical replacement. A non-404 Discord failure SHALL retain the existing identity and SHALL NOT create a replacement.

#### Scenario: Board refresh finds a deleted active detail
- **WHEN** an active raid points to a Discord detail message that was manually deleted
- **THEN** Refresh creates one replacement and updates the board link without changing the raid, leader, or call state

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
A frozen planned raid detail message SHALL expose a secondary `Cancel review` button in the same action row immediately after `Call and start raid`. When authorized staff select it from the canonical detail message, the system SHALL atomically clear that exact stored message reference, delete the Discord message, and refresh the canonical board without a details link. It SHALL retain the planned frozen raid, stable order, manual placement, leader reservation, call state, memberships, and help requests. A later explicit Review action MAY create new details.

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

### Requirement: Pull attempts one bounded push-down
After a pull removes the selected requester from its source, the same atomic transition SHALL examine the source remainder. If no requester remains, the source SHALL close as not run. Otherwise, the system SHALL consider only the immediately following planned, unreviewed, automatically fillable, unreserved raid after the source in normal grouping order with the same game mode and map. If that one raid has capacity for the complete remainder, every remaining source requester SHALL move together into it in stable source order and the empty source SHALL close as not run. If the complete remainder does not fit or no eligible immediate raid exists, no remainder member SHALL move and the source SHALL remain planned.

Push-down SHALL NOT cross game modes or maps; split the remainder; continue into another raid; assign or change a leader; start the raid; or send a call. Every membership move and source closure SHALL be committed atomically with the selected pull and enforced by D1 compatibility and capacity constraints.

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

#### Scenario: Push write fails
- **WHEN** any request, membership, capacity, source closure, or push-target write fails
- **THEN** the selected pull and every optional push-down mutation roll back together

### Requirement: Raid calls include map entry requirements
The committed Tarkov map catalog SHALL define one mode-independent preparation reminder for each restricted location. The reminder SHALL apply identically to PvP Seasonal, PvP, and PvE and SHALL contain the approved items, fees, and conditions that players must bring for the raid.

The catalog SHALL define these reminders:

- The Lab: each player needs a TerraGroup Labs access keycard.
- The Labyrinth: each player needs a Labrys access keycard, and the party needs one Knossos LLC facility key.
- Terminal: each player needs one accepted access option: a Reprogrammed RFID keycard with Mr. Kerman's hash codes together with the Secure container Alpha-1 with TerraGroup evidence, an RFID keycard with unknown name, a Reprogrammed RFID keycard with Prapor's hash codes, or Prapor's letter for the port checkpoint. Entry is through Shoreline from 21:00 to 06:00.
- Icebreaker: each player needs a `Sudak-Tudak kit` and the current Euro exit fee; the reminder SHALL NOT list a Rouble fee or commit numeric amounts.

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

#### Scenario: Icebreaker call covers the entry kit and exit fee
- **WHEN** an Icebreaker raid call is sent
- **THEN** both platform calls tell each player to bring a `Sudak-Tudak kit` and the current Euro exit fee, with no Rouble fee or numeric amounts

#### Scenario: Standard map call remains concise
- **WHEN** a raid call is sent for a committed map without an entry requirement
- **THEN** its existing content has no `Bring:` guidance

#### Scenario: Requirement text is identical across modes
- **WHEN** calls are rendered for the same restricted location in PvP Seasonal, PvP, and PvE
- **THEN** every call uses the same catalog entry requirement apart from its existing mode label

#### Scenario: Longest Twitch call remains valid
- **WHEN** the maximum supported requester party has maximum-length valid Twitch logins and the longest entry reminder
- **THEN** the complete Twitch call remains within the platform message-length limit

### Requirement: Board Refresh reuses one consistent snapshot
The Discord board Refresh action SHALL acknowledge the interaction without directly writing canonical message content. It SHALL mark the board dirty and update the canonical board only through the leased drain. The drain SHALL read one complete board snapshot and use it for that canonical render. It SHALL NOT assign or repair help requests.

After the canonical drain completes, visible raid-detail reconciliation SHALL run as separate best-effort background work. Reconciliation MAY re-read an individual visible raid to validate its current detail-message state, but SHALL NOT reload the complete board merely to validate that raid. Changing, clearing, or replacing a stored raid-detail message identity SHALL atomically mark the canonical board dirty and SHALL schedule another bounded leased drain so the board link cannot remain stale.

Every Discord REST timeout used by board drain or reconciliation SHALL be shorter than the board lease. The Refresh interaction SHALL NOT wait for detail reconciliation before its acknowledgement.

#### Scenario: Staff refresh the current board
- **WHEN** eligible staff select `Refresh`
- **THEN** the interaction receives a short private acknowledgement and the canonical message is updated once through the leased drain from its current D1 snapshot

#### Scenario: A visible raid detail needs reconciliation
- **WHEN** the rendered snapshot contains a reviewed or active raid with stored details
- **THEN** the canonical drain completes before separate best-effort detail validation begins

#### Scenario: A detail message identity changes during reconciliation
- **WHEN** detail reconciliation clears or replaces a stored Discord message identity
- **THEN** D1 advances the board dirty version and a later leased drain renders the new link state

#### Scenario: Detail REST request stalls
- **WHEN** Discord does not complete a detail request before the configured REST timeout
- **THEN** the timeout occurs before the board lease expires and the canonical drain is not falsely completed by that request

### Requirement: Open raid hydration is independent of membership history
Planned and active raid reads SHALL select only current membership rows in SQL and SHALL use the partial open-membership index. Terminal raid reads SHALL select only the membership states required by their outcome. Staff mutations SHALL reuse returned state or perform no more than one necessary post-mutation hydration unless an explicit concurrency check requires another read.

#### Scenario: Open raid has extensive removed-member history
- **WHEN** staff review, call, postpone, remove from, record, or reconcile an open raid with many removed memberships
- **THEN** historical memberships are not returned to the Worker and D1 row reads remain bounded by current participants and the requested action

#### Scenario: Completed raid participants are rendered
- **WHEN** staff record a terminal raid result
- **THEN** the result read returns the completed participants required for the message without loading unrelated removed history

#### Scenario: Several reviewed raids are reconciled
- **WHEN** the visible board contains up to ten reviewed or active raids
- **THEN** reconciliation bulk-hydrates the visible raid IDs and candidate summaries instead of repeating unrestricted per-raid history reads

### Requirement: Legacy repair reads only groups demanded by its page
One deployment repair pass SHALL select no more than 80 state-`0` requests. Its compatible-raid lookup SHALL include only game-mode and map buckets represented by that selected page and SHALL return no more usable partial raids per bucket than the page's demand can consume. Unrelated partial raids SHALL NOT increase the pass's D1 rows returned to the Worker.

#### Scenario: No legacy request exists
- **WHEN** deployment invokes repair with no state-`0` request
- **THEN** repair returns without reading partial raid groups

#### Scenario: Selected page uses few buckets
- **WHEN** 80 selected legacy requests use a subset of the stored mode and map combinations
- **THEN** repair reads compatible partial raids only for that subset and caps each bucket by its selected demand

#### Scenario: Legacy backlog needs several pages
- **WHEN** more than 80 legacy requests remain
- **THEN** each invocation repairs one bounded page and later calls can continue without one call loading the complete backlog or partial-group population

### Requirement: Canonical board synchronization coalesces and converges
Every committed queue change SHALL increment a monotonic board dirty version. Canonical-board synchronization SHALL use one D1 lease holder to render and PATCH a versioned snapshot, SHALL advance the rendered version only after a successful PATCH, and SHALL use compare-and-set so an older snapshot cannot mark or overwrite a newer version. The lease holder SHALL perform a bounded drain when more changes arrive. Concurrent triggers MAY coalesce into one PATCH.

#### Scenario: Request burst changes the queue
- **WHEN** 10 or 100 request transactions commit while board synchronization overlaps
- **THEN** the board converges to the newest committed dirty version without one complete snapshot and PATCH per request

#### Scenario: Older Discord PATCH finishes later
- **WHEN** an older synchronization attempt completes after a newer dirty version exists
- **THEN** it cannot mark the newer version rendered or leave the canonical board older than the newest successful drain

#### Scenario: Discord PATCH fails
- **WHEN** the lease holder cannot update the canonical board
- **THEN** it does not advance the rendered version and a later drain can retry the dirty work

#### Scenario: Staff select Refresh
- **WHEN** authorized staff select `Refresh`
- **THEN** Refresh uses a current snapshot and current controls through the serialized drain or returns short retry guidance instead of issuing an unordered canonical PATCH

#### Scenario: A current membership position has a gap
- **WHEN** a current member was removed from a non-final position and another compatible request is appended through intake, repair, or postponement
- **THEN** the new member receives a position after the highest current position without colliding with an existing membership

#### Scenario: Board state changes during creation or replacement
- **WHEN** the queue changes after a board snapshot is rendered but before its Discord message ID is stored
- **THEN** only the rendered snapshot version is acknowledged and a later bounded drain renders the newer dirty version

#### Scenario: Several callers create a missing canonical board
- **WHEN** concurrent authorized calls observe no canonical board message
- **THEN** one lease holder stores one canonical message and any losing created message is deleted

#### Scenario: Work remains after one bounded drain
- **WHEN** a newer dirty version still exists after three render attempts
- **THEN** the tracked execution context schedules another bounded drain and final telemetry includes that follow-up

#### Scenario: Manual Refresh is acknowledged
- **WHEN** staff select `Refresh`
- **THEN** the interaction returns a caller-only acknowledgement and only the leased canonical drain writes board content

#### Scenario: Discord board request exceeds its deadline
- **WHEN** a canonical Discord REST request does not finish before the timeout shorter than the board lease
- **THEN** the request is canceled without acknowledging the dirty version as rendered

#### Scenario: Canonical message cannot be recorded
- **WHEN** Discord creates a board message but D1 fails or loses the compare-and-set that records it
- **THEN** the Worker attempts to delete the unrecorded Discord message and leaves board work dirty

### Requirement: Follow-up and legacy candidate work is demand-bounded
One legacy repair pass SHALL fetch at most the candidate count required by its selected 80-request page before candidate hydration. Pull and postpone behavior SHALL preserve requester order and follow-up reuse while its D1 cost is tested against at least 10,000 removed memberships on the relevant raid. A history index or summary structure SHALL be retained only with local evidence that its read reduction justifies its write and storage cost.

#### Scenario: Many compatible raids exceed selected legacy demand
- **WHEN** a selected repair bucket needs two raids and thousands of compatible partial raids exist
- **THEN** candidate hydration returns at most two indexed raids for that bucket

#### Scenario: Removed history is extensive
- **WHEN** staff pull or postpone a requester from a raid with 10,000 removed memberships
- **THEN** the operation preserves the same destination and order semantics and remains within its reviewed operation-family budget

### Requirement: Discord staff interactions acknowledge before REST work
An authorized Discord staff interaction that requires an outbound Discord REST request SHALL send its initial acknowledgement before that request starts. When the final private response contains a board link, raid-detail link, or REST-dependent result, the system SHALL use a deferred ephemeral response and update that interaction response in background work. An interaction that requires only bounded D1 work and a native interaction update MAY return its final response directly.

#### Scenario: Staff open the board
- **WHEN** authorized staff invoke `/board`
- **THEN** Discord receives a deferred ephemeral acknowledgement before canonical-board creation or update and the final private response contains the board link

#### Scenario: Staff review a raid
- **WHEN** authorized staff select a valid planned raid for review
- **THEN** Discord receives a deferred ephemeral acknowledgement before the detail-message REST request and the final private response contains the retained detail link or a concise failure

#### Scenario: Staff action closes a detail message
- **WHEN** a valid Cancel review, Helped, Postpone raid, Remove requester, or Postpone requester transition needs to delete a Discord message
- **THEN** the interaction is acknowledged before deletion and the final private response reports the REST-dependent outcome

#### Scenario: Staff action updates the current interaction message
- **WHEN** a call, unsuccessful result, or non-terminal requester action requires no outbound Discord REST request
- **THEN** the system MAY return the final native message update after its bounded D1 transition

### Requirement: Raid-call status is fenced to its active start
Best-effort Discord and Twitch call completion SHALL update a raid only when it remains active, its stored start time equals the start that requested the call, and that platform's status remains pending. The completion SHALL NOT move `updated_at` backwards. A stale, repeated, or late completion SHALL write no raid row and SHALL NOT alter a later raid run.

#### Scenario: Current call completes
- **WHEN** a platform call finishes for the same active raid start and its status is pending
- **THEN** the system records sent or failed and preserves a monotonic update time

#### Scenario: Raid changed before call completion
- **WHEN** the raid was postponed, closed, or started again after the best-effort call began
- **THEN** the old completion writes no status and does not alter the current run

#### Scenario: Status completion repeats
- **WHEN** a second completion arrives after the platform status is no longer pending
- **THEN** it writes no raid row

### Requirement: Follow-up relationships use source-owned lifecycle
The system SHALL store a follow-up relationship only while both its source and target raids remain open. Reusing an existing relationship SHALL not update an unused timestamp. Closing a source raid SHALL delete relationships owned by that source through an indexed source-key lookup. Closing a target SHALL delete relationships to that target through an indexed target-key lookup and SHALL NOT scan the complete follow-up table. Cleanup SHALL preserve unrelated live relationships.

#### Scenario: Last requester is postponed
- **WHEN** postponement closes the source raid and creates or reuses a compatible destination
- **THEN** the system does not insert a relationship owned by the closed source

#### Scenario: Relationship already exists
- **WHEN** another requester from the same open source uses the same destination
- **THEN** relationship insertion does nothing and does not rewrite its timestamp

#### Scenario: Source closes with unrelated history present
- **WHEN** a source closes while many relationships belong to other sources
- **THEN** cleanup deletes that source's relationships and any relationships targeting that source through their respective indexes, without changing unrelated relationships

#### Scenario: Target closes before source
- **WHEN** a target raid closes while its source remains open
- **THEN** cleanup removes its relationships immediately so later source queries do not read closed target history


### Requirement: Unified raid service order
Open raids SHALL use one effective order: active raids first, then pinned planned raids with the latest pin first, then normal planned raids in stable FIFO order. Normal grouping placement SHALL remain independent of manual placement. Pinning SHALL preserve members, automatic filling, leadership, review state, and call state. Only the configured streamer SHALL change manual placement, and only planned raids SHALL accept the action. The board SHALL label manually placed planned raids Pinned and name the placement controls Pin to top and Unpin. Starting or whole-raid postponement SHALL clear manual placement. Ordering controls SHALL validate the current canonical message and board revision inside a guarded transaction.

#### Scenario: Streamer pins and unpins a raid
- **WHEN** the streamer selects Pin to top, then Unpin on a current planned raid
- **THEN** it first precedes other planned work and then returns to normal placement without changing membership or calls

#### Scenario: Volunteer or stale control attempts ordering
- **WHEN** a volunteer uses ordering or a control refers to an old board version or another message
- **THEN** the action changes no raid, request, membership, or placement

#### Scenario: Active raid remains in progress
- **WHEN** planned raids are pinned or the new Worker refreshes an existing active raid
- **THEN** active membership, leadership, start time, and call state remain unchanged and active raids stay before planned work

### Requirement: Shared paged raid board
The canonical board SHALL show at most ten complete compact raid rows and identify the current page and total raid count. Each row SHALL identify mode, map, all current Twitch logins, leader state, and a details link when present. Goals and notes SHALL remain in raid details. Previous and Next SHALL use bounded indexed keyset reads and permit only streamer navigation. All staff SHALL see one shared page. Navigation SHALL use the existing versioned leased canonical writer and SHALL reject stale revisions or noncanonical messages. Every data update, Refresh, Pin to top, and Unpin SHALL reset to page one. Navigation itself SHALL retain its selected page. Review and ordering selectors SHALL contain only eligible displayed raids. Pin to top SHALL list only unpinned planned raids, and Unpin SHALL list only pinned planned raids. An ordering selector SHALL be omitted when no eligible displayed raid remains. All payloads SHALL fit Discord embed and component limits after escaping, without truncating Twitch names.

#### Scenario: Pinned raids are excluded from pin choices
- **WHEN** a board page contains pinned and unpinned planned raids
- **THEN** Pin to top offers only unpinned raids, Unpin offers only pinned raids, and Review still offers both

#### Scenario: All displayed planned raids are pinned
- **WHEN** every displayed planned raid is pinned
- **THEN** Pin to top is absent while Review and Unpin remain available

#### Scenario: Streamer browses beyond the first page
- **WHEN** more than ten raids exist and the streamer selects Next
- **THEN** the shared board shows the next bounded page with valid previous and next controls

#### Scenario: Data changes during navigation
- **WHEN** a request or raid change commits while navigation is rendering
- **THEN** the final leased drain displays page one of the newest state

#### Scenario: Refresh occurs on a later page
- **WHEN** authorized staff select Refresh
- **THEN** the canonical board returns to page one and replaces retired controls without calling requesters

#### Scenario: Full rows use the longest valid names
- **WHEN** ten four-requester raids contain maximum-length escaped Twitch names and details links
- **THEN** the complete formatted payload stays within Discord limits

### Requirement: Attempt-free raid completion and postponement
Starting SHALL activate the reviewed raid and call its current members once. Helped SHALL atomically complete only current memberships and their requests and retain successful raid and leader statistics. Postpone raid SHALL preserve the remaining group, return it to planned state at the unified tail, clear manual placement and calls, retain its leader reservation, disable automatic filling, and require a new explicit start. Both actions SHALL clear the stored detail-message identity and delete the obsolete message. Runtime state and controls SHALL expose no raid attempt counter or unsuccessful-attempt action. Retired unsuccessful controls SHALL return private refresh guidance without changing durable state.

#### Scenario: Unsuccessful in-game run
- **WHEN** an active raid does not achieve its goal
- **THEN** staff can continue without recording a bot attempt

#### Scenario: Previously pinned raid is postponed
- **WHEN** its leader postpones the active raid
- **THEN** its remaining members stay together at the unified tail and receive no new call until explicit start

#### Scenario: Terminal message deletion fails
- **WHEN** Helped or Postpone raid commits but Discord rejects deletion
- **THEN** the durable transition remains, the stored message identity stays cleared, old controls cannot repeat it, and the leader receives a private warning

#### Scenario: A source contains historical removed membership
- **WHEN** Helped completes a raid after one requester was postponed out of it
- **THEN** only current completed memberships close their requests and the postponed request stays active in its follow-up raid
