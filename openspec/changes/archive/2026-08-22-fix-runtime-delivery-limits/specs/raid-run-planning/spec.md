## ADDED Requirements

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
The system SHALL store a follow-up relationship only while its source raid remains open after requester postponement. Reusing an existing relationship SHALL not update an unused timestamp. Closing a source raid SHALL delete only relationships owned by that source through an indexed source-key lookup. Closing a target SHALL NOT scan the complete follow-up table; readers SHALL ignore closed targets until their owning sources close.

#### Scenario: Last requester is postponed
- **WHEN** postponement closes the source raid and creates or reuses a compatible destination
- **THEN** the system does not insert a relationship owned by the closed source

#### Scenario: Relationship already exists
- **WHEN** another requester from the same open source uses the same destination
- **THEN** relationship insertion does nothing and does not rewrite its timestamp

#### Scenario: Source closes with unrelated history present
- **WHEN** a source closes while many relationships belong to other sources
- **THEN** cleanup deletes only that source's relationships through the source-key order

#### Scenario: Target closes before source
- **WHEN** a target raid closes while its source remains open
- **THEN** candidate queries ignore the closed target and later source closure removes the retained relationship

## MODIFIED Requirements

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
