## MODIFIED Requirements

### Requirement: Queue reports personal mode position
Queue SHALL select the caller's earliest active request by effective raid service order. It SHALL report that request's mode and map, its ordinal among current requesters in that mode ordered by raid and membership placement, and preceding raids in global effective order. Other active mode-and-map pairs SHALL remain available. Discord and Twitch SHALL use the same order and retain independent 100-request and 50-raid exactness limits. Reads SHALL remain capped and indexed. Queue SHALL omit aggregate totals, internal references, stable IDs, identity-link state, and request notes. The ordinal SHALL describe requester order within the selected mode rather than a seat in one raid.

#### Scenario: A later request is pinned ahead
- **WHEN** the streamer pins its planned raid to the top
- **THEN** both queue commands select and report positions according to the new effective order

#### Scenario: Caller has multiple active requests
- **WHEN** a caller has several active mode-and-map pairs
- **THEN** Queue selects the earliest in effective service order and names the other pairs without internal references or private notes

#### Scenario: Viewer is beyond an exactness limit
- **WHEN** more than the capped preceding work exists
- **THEN** Queue reports its existing lower bound without scanning the complete backlog
