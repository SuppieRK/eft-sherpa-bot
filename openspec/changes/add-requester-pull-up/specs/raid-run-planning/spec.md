## ADDED Requirements

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
When Refresh finds that an active raid detail message does not exist, the system SHALL create one replacement with current result and requester controls and atomically replace the stale reference. Concurrent recovery SHALL retain only one canonical replacement.

#### Scenario: Board refresh finds a deleted active detail
- **WHEN** an active raid points to a Discord detail message that was manually deleted
- **THEN** Refresh creates one replacement and updates the board link without changing the attempt, leader, or call state

### Requirement: Staff can cancel a planned raid review
A frozen planned raid detail message SHALL expose a secondary `Cancel` button. When authorized staff select it from the canonical detail message, the system SHALL atomically clear that exact stored message reference, delete the Discord message, and refresh the canonical board without a details link. It SHALL retain the planned frozen raid, queue kind, stable order, leader reservation, attempt count, call state, memberships, and help requests. A later explicit Review action MAY create new details.

The system SHALL reject a stale or duplicate message, an unreviewed raid, and an active or terminal raid without deleting its current details or changing raid state. A Discord `404` SHALL count as a successful deletion. If another Discord deletion error occurs after the reference clears, the system SHALL attempt to restore the same reference and SHALL tell staff to retry. Active raid details SHALL NOT expose `Cancel`.

#### Scenario: Staff cancel a planned review
- **WHEN** authorized staff select `Cancel` on the canonical details for a frozen planned raid
- **THEN** the details message is deleted, its stored link is cleared, and the unchanged raid remains available on the board

#### Scenario: Staff use a stale Cancel control
- **WHEN** a Cancel interaction comes from a message that is no longer the raid's canonical planned detail
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
