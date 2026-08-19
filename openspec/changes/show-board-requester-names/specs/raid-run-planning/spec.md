## MODIFIED Requirements

### Requirement: Split canonical board windows
The canonical staff board SHALL display at most three outstanding Priority raids and seven outstanding Ordinary raids. Within each section, it SHALL reserve at least one visible raid for each non-empty game mode by selecting the oldest outstanding raid from every non-empty mode, ordering those heads by stable raid order, and filling remaining visible slots from all unselected raids in stable FIFO order. FIFO order within each mode SHALL remain stable.

Each section SHALL use bounded per-mode queries, apply its limit after the mode-presence merge, and say `Showing X of Y raids (up to N).` The board SHALL NOT show an additional help-request or outstanding-raid counter and SHALL NOT use `OFFSET`, page state, navigation, unused-limit borrowing, proportional quotas, or round-robin balancing. Every displayed raid SHALL identify its mode and map, list every current requester by Twitch login, and omit the leader-inclusive party-occupancy fraction. Complete requester goals and notes SHALL remain in the raid-specific detail message.

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

#### Scenario: One requester is waiting for a planned raid
- **WHEN** the canonical board renders a planned Woods raid containing only Twitch requester `chosen` and no assigned leader
- **THEN** the raid summary says `Requesters: @chosen`, does not show a party-occupancy fraction, and continues to say that the leader is assigned when called

#### Scenario: Several requesters are grouped
- **WHEN** the canonical board renders a raid containing several current requesters
- **THEN** the raid summary lists every requester's Twitch login while objectives and notes remain available only in raid details
