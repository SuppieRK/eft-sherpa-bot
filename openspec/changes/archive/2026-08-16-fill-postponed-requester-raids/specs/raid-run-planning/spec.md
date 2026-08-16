## MODIFIED Requirements

### Requirement: Individual postponement creates or reuses the next same-queue raid
Postponing a requester SHALL remove that requester from the active raid and append it to the earliest planned same-map follow-up for that source with spare capacity, or create a follow-up immediately after the source's existing follow-up chain. The source seat SHALL remain empty. A follow-up SHALL reserve the same leader, start at attempt zero, accept automatic same-map filling from its queue kind, and enforce the map-specific requester capacity.

#### Scenario: Two requesters are postponed from one raid
- **WHEN** a leader postpones two requesters from the same active raid and the first follow-up has capacity
- **THEN** both requesters remain planned as members of that one follow-up raid

#### Scenario: Last requester is postponed
- **WHEN** the source raid has no remaining requester
- **THEN** the source becomes `not_run`, its obsolete message is deleted, and the fillable follow-up takes its queue position when no earlier follow-up exists

#### Scenario: Existing follow-up is full
- **WHEN** another requester is postponed and every existing follow-up for the source is full
- **THEN** a new fillable follow-up is created after the existing follow-up chain without exceeding map capacity

#### Scenario: Follow-up reuse or creation fails
- **WHEN** any source, ordering, destination, or membership write fails
- **THEN** the active source and requester membership remain unchanged
