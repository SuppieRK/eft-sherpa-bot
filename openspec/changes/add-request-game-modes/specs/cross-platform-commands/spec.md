## RENAMED Requirements

- FROM: `### Requirement: Queue reports personal global position`
- TO: `### Requirement: Queue reports personal mode position`

## MODIFIED Requirements

### Requirement: Shared public command words
Discord SHALL expose `/request` with a required game-mode choice and `/queue`. Twitch SHALL expose `!request [mode] [map] [goal]` and `!queue`. Queue SHALL accept no arguments. `/position`, `!position`, and `/spike` SHALL NOT be registered public commands.

#### Scenario: Queue is checked on either platform
- **WHEN** `/queue` or `!queue` is invoked
- **THEN** the reply contains the authenticated caller's next mode-scoped position when one exists

#### Scenario: Caller has no request
- **WHEN** a caller without an active request checks queue
- **THEN** the bot returns only short platform-specific request guidance without revealing another viewer

#### Scenario: Request omits game mode
- **WHEN** a viewer attempts to submit a request without selecting or typing a supported mode
- **THEN** no request is created and the bot gives short guidance for PvP Seasonal, PvP, and PvE

### Requirement: Queue reports personal mode position
When the caller has an active request, Queue SHALL report its game mode, map, priority-first request order within that mode, projected raids ahead, and other active mode-and-map pairs. The ordinal SHALL be the caller request's position across active requests in the selected mode and SHALL NOT describe a seat within one raid. Priority raids SHALL count ahead of ordinary raids.

For raids-ahead ordering within each queue kind, Queue SHALL take the oldest outstanding raid from every non-empty mode, order those mode heads by stable raid order, and then append all remaining raids in stable FIFO order. Queue SHALL apply Priority before Ordinary and SHALL use the same ordering as the staff board. Queue SHALL omit aggregate request and raid totals, redundant `Queue:` and `You:` labels, internal references, request notes, stable IDs, and identity-link state.

Queue SHALL report an exact ordinal through 100 requests ahead and an exact raid count through 50 raids ahead. If more work precedes the caller, it SHALL report `More than 100 requests ahead` and/or `more than 50 raids ahead` for the capped dimension. The two limits SHALL apply independently and SHALL be identical on Discord and Twitch.

#### Scenario: Caller has several mode-and-map requests
- **WHEN** the caller checks queue with active requests for several mode-and-map pairs
- **THEN** the earliest request is described with its mode and map and the other active mode-and-map pairs are named

#### Scenario: Same map is requested in different modes
- **WHEN** the caller has active requests for the same map in two game modes
- **THEN** Queue reports them as distinct mode-and-map pairs

#### Scenario: Ordinary caller waits behind priority work
- **WHEN** an ordinary caller checks queue while priority raids are outstanding
- **THEN** those priority raids are included in the caller's raids-ahead count using mode-presence ordering

#### Scenario: Minority mode has outstanding work
- **WHEN** one mode has one outstanding raid and another mode has enough earlier raids to fill a board section
- **THEN** Queue calculates raids ahead from an order that includes the minority mode's oldest raid among the section's visible raids

#### Scenario: Caller is deep in a large queue
- **WHEN** more than 100 same-mode requests or more than 50 mode-ordered raids precede the caller
- **THEN** Queue reports the applicable lower bound without scanning the complete preceding queue
