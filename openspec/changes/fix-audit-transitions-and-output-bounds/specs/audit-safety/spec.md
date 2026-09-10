## ADDED Requirements

### Requirement: Atomic staff transitions
Remove, requester postponement, and Helped SHALL validate current raid and membership state in the transaction. Stale actions SHALL leave no partial request, membership, raid, or rollup changes.

#### Scenario: Requester moves before removal commits
- **WHEN** postponement wins against removal from the old raid
- **THEN** the requester remains active in the destination

#### Scenario: Pull changes the source party
- **WHEN** a pull wins after postponement reads a sole requester
- **THEN** postponement either rejects without writes or preserves the new member in an open source raid

#### Scenario: Whole raid postponement wins against Helped
- **WHEN** the raid becomes planned before Helped commits
- **THEN** Helped does not complete its requests or memberships

### Requirement: Bounded follow-up lifecycle
Repeated pulls and postponements SHALL preserve strict raid order without key collisions. Closed follow-up history SHALL NOT cause unbounded reads during later postponements.

#### Scenario: Repeated follow-ups between adjacent raids
- **WHEN** staff create more than twenty follow-ups through repeated pulls and postponements
- **THEN** each action preserves valid order without a unique-key failure

#### Scenario: Many closed follow-ups
- **WHEN** a source remains open after many follow-up raids close
- **THEN** later postponement work depends on live follow-ups, not retained closed history

### Requirement: Bounded platform output
Twitch queue replies SHALL fit 500 characters and retain the primary request position. Discord raid detail fields SHALL fit 1024 characters and retain complete accepted goals and notes.

#### Scenario: Viewer has every mode and map combination
- **WHEN** the viewer requests the queue on Twitch
- **THEN** the reply fits the limit and identifies omitted additional requests with a count

#### Scenario: Markdown expands maximum-length details
- **WHEN** valid requester details contain Markdown characters at all field limits
- **THEN** the Discord payload stays within field and message limits without losing goals or notes

### Requirement: Safe public Discord attachment
Both Discord request submission and linking SHALL permit self-service attachment to an unlinked Twitch mapping and updates to the same Discord member. Only trusted staff SHALL replace an existing different Discord member. Denial SHALL leave identity and request data unchanged.

#### Scenario: Public caller attempts replacement
- **WHEN** a non-staff caller submits another member's linked Twitch login
- **THEN** the command rejects the replacement and asks for staff help

#### Scenario: Staff correct a link
- **WHEN** the streamer or a volunteer replaces a Discord member
- **THEN** the mapping changes and retains existing uniqueness rules
