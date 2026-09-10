## MODIFIED Requirements

### Requirement: One leader and bounded capacity
Each started raid SHALL have one leader who is the configured streamer or eligible volunteer. Requester capacity SHALL be `min(configured recipient limit, map party capacity - 1)`.

The disposable D1 baseline SHALL accept only committed map identifiers and SHALL reject a stored requester capacity above `map party capacity - 1`. Standard five-person maps SHALL accept at most four requesters and three-person Icebreaker SHALL accept at most two. Membership insert and move triggers SHALL enforce the stored validated capacity.

#### Scenario: Volunteer claims a raid
- **WHEN** an eligible volunteer starts an ordinary or priority planned raid
- **THEN** the volunteer becomes leader and the raid can proceed without the streamer

#### Scenario: Runtime recipient limit exceeds a map party
- **WHEN** grouping runs with a recipient limit above the selected map's physical capacity
- **THEN** it creates raids with no more than `map party capacity - 1` requesters and D1 rejects any later membership overflow

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
