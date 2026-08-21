## MODIFIED Requirements

### Requirement: Unlimited queue-specific automatic grouping
The system SHALL materialize every waiting request immediately into planned draft raid groups with the same game mode, map, and queue kind. It SHALL fill the earliest eligible compatible unreviewed raid with capacity, append another raid when needed, preserve existing memberships, and persist no separate grouping state. Concurrent materialization SHALL use current request state, current destination capacity, and current membership positions inside the committing D1 batch, then perform a bounded replan when another invocation wins an expected uniqueness or capacity race. D1 SHALL reject an open membership whose request and raid differ in game mode, map, or queue kind.

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

#### Scenario: Concurrent requests need the same capacity
- **WHEN** several valid requests are created concurrently for compatible raids
- **THEN** every accepted request obtains one membership, no empty or duplicate raid remains, and no raid exceeds requester capacity

#### Scenario: Incompatible membership is written directly
- **WHEN** a database write attempts to add an active request to a raid with another mode, map, or queue kind
- **THEN** D1 rejects the write without changing membership state

#### Scenario: An open raid cannot accept automatic members
- **WHEN** an active or reviewed raid owns the last order key and another request needs a new compatible raid
- **THEN** the new raid appends after every open raid without an order-key collision

#### Scenario: Matching request arrives after review opens
- **WHEN** staff open a planned raid for review and a later request has the same queue kind, mode, and map
- **THEN** the reviewed raid keeps its displayed membership and the later request enters another compatible planned raid
