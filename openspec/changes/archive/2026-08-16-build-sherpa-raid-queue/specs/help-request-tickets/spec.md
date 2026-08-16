## ADDED Requirements

### Requirement: Twitch-native request intake
The system SHALL accept `!request <map> [goal]`, use authenticated Twitch identity, resolve the longest exact map-alias prefix, default a missing goal to `General raid help`, and use the Twitch login as the initial in-game name.

#### Scenario: Minimum Twitch request is submitted
- **WHEN** a viewer sends `!request customs`
- **THEN** one Customs request is created without registration or Discord linkage

#### Scenario: Twitch goal exceeds the limit
- **WHEN** the supplied goal exceeds 150 characters
- **THEN** no request is created and the reply gives the 150-character limit

### Requirement: Discord-native request intake
The system SHALL expose `/request` as a Discord modal requiring Twitch name, in-game name, supported map, and objective and accepting optional notes. Objective SHALL be 1–150 characters. Notes SHALL be absent or 1–250 characters. The form SHALL state both limits.

#### Scenario: Known caller opens the form
- **WHEN** the Discord caller has a Twitch-first mapping
- **THEN** the Twitch and stored in-game names are prefilled and remain editable

#### Scenario: Stored text is too long
- **WHEN** either platform attempts to persist text outside the limits
- **THEN** domain validation or D1 rejects it without truncation

### Requirement: One active request per viewer and map
The database SHALL enforce at most one waiting or planned request per normalized Twitch login and map across both intake platforms.

#### Scenario: Active map is requested again
- **WHEN** the same Twitch login requests an active map again
- **THEN** the existing request and queue order remain unchanged

### Requirement: Twitch-first identity and reusable in-game name
Every request SHALL contain a normalized Twitch login plus an authenticated Discord or Twitch caller ID. The Twitch-first mapping SHALL retain optional stable platform IDs and one reusable Escape from Tarkov name.

#### Scenario: Discord supplies a better in-game name
- **WHEN** a mapped Discord viewer submits a valid request
- **THEN** the mapping stores that in-game name for later forms

### Requirement: Stable fair order and postponement priority
Every request SHALL receive an immutable arrival sequence and an ordinary or priority queue kind. New requests SHALL be ordinary. Whole-raid postponement SHALL change the remaining requests to priority without changing their arrival sequence or raid membership.

#### Scenario: Whole raid is postponed
- **WHEN** staff postpones an unresolved raid
- **THEN** its remaining requests stay together in the same raid at the end of Priority with attempts reset

### Requirement: Small request lifecycle
Request state SHALL be `waiting`, `planned`, `completed`, or `canceled`. Helped requests become completed. Postponed requests remain active.

#### Scenario: Requester is postponed
- **WHEN** the raid leader postpones one requester
- **THEN** the request remains planned in the dedicated next raid

#### Scenario: Requester is removed
- **WHEN** the raid leader removes one requester
- **THEN** the request becomes canceled and automatic materialization cannot add it to another raid
