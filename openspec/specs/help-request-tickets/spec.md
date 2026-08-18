# Help Request Tickets Specification

## Purpose

Define Twitch-first help-request intake, identity, validation, ordering, and lifecycle.

## Requirements

### Requirement: Twitch-native request intake
The system SHALL accept `!request [mode] [map] [goal]`, use authenticated Twitch identity, resolve the longest exact mode-alias prefix before the longest exact map-alias prefix, default a missing goal to `General raid help`, and use the Twitch login as the initial in-game name. It SHALL accept `pvp-seasonal`, `pvp seasonal`, and `seasonal` for PvP Seasonal, `pvp` for PvP, and `pve` for PvE.

#### Scenario: Minimum Twitch request is submitted
- **WHEN** a viewer sends `!request pve customs`
- **THEN** one PvE Customs request is created without registration or Discord linkage

#### Scenario: Two-token Seasonal alias is submitted
- **WHEN** a viewer sends `!request pvp seasonal customs task help`
- **THEN** one PvP Seasonal Customs request is created with `task help` as its goal

#### Scenario: Short Seasonal alias is submitted
- **WHEN** a viewer sends `!request seasonal customs task help`
- **THEN** one PvP Seasonal Customs request is created with `task help` as its goal

#### Scenario: Twitch mode is unknown
- **WHEN** a viewer supplies a mode other than a supported token or alias
- **THEN** no request is created and the reply gives the accepted mode values and request shape

#### Scenario: Twitch goal exceeds the limit
- **WHEN** the supplied goal exceeds 150 characters
- **THEN** no request is created and the reply gives the 150-character limit

### Requirement: Discord-native request intake
The system SHALL expose `/request` with a game-mode choice of PvP Seasonal, PvP, or PvE registered with `required: true` before it opens the existing Discord modal. Discord SHALL NOT submit the command or open the modal until the viewer selects a mode. The modal SHALL require Twitch name, in-game name, supported map, and objective and SHALL accept optional notes. Objective SHALL be 1–150 characters. Notes SHALL be absent or 1–250 characters. The form SHALL state both limits. The selected mode SHALL be carried in versioned modal state and SHALL NOT consume a sixth modal component. A valid legacy version-one modal submission that was opened before deployment SHALL be treated as PvE.

#### Scenario: Discord request is opened without a mode
- **WHEN** a viewer attempts to invoke `/request` without selecting a game mode
- **THEN** Discord blocks command submission and the bot does not open a request modal

#### Scenario: Known caller opens the form
- **WHEN** the Discord caller selects a mode and has a Twitch-first mapping
- **THEN** the modal retains the selected mode while the Twitch and stored in-game names are prefilled and remain editable

#### Scenario: Legacy form is submitted during deployment
- **WHEN** Discord submits a valid version-one request modal without encoded mode
- **THEN** the request is validated and persisted as PvE

#### Scenario: New modal state has no valid mode
- **WHEN** Discord submits a new-version request modal with missing or unknown mode state
- **THEN** no request is created and the caller receives private retry guidance

#### Scenario: Stored text is too long
- **WHEN** either platform attempts to persist text outside the limits
- **THEN** domain validation or D1 rejects it without truncation

### Requirement: One active request per viewer, mode, and map
The database SHALL enforce at most one waiting or planned request per normalized Twitch login, game mode, and map across both intake platforms. A viewer MAY hold active requests for the same map in different modes.

#### Scenario: Active mode and map are requested again
- **WHEN** the same Twitch login requests an active mode-and-map pair again
- **THEN** the existing request and queue order remain unchanged

#### Scenario: Same map is requested in another mode
- **WHEN** the same Twitch login requests an active map in a different game mode
- **THEN** a separate request is accepted for that mode without changing the earlier request

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

### Requirement: Compatible requests fill requester-postponement follow-ups
A planned requester-postponement follow-up SHALL accept later waiting requests for the same game mode, map, and queue kind while requester capacity remains. Automatic filling SHALL preserve existing memberships and SHALL NOT promote an Ordinary request into Priority.

#### Scenario: Compatible request follows an individual postponement
- **WHEN** an Ordinary follow-up has spare capacity and a later Ordinary request selects the same mode and map
- **THEN** the later request becomes a member of that follow-up instead of creating a separate raid

#### Scenario: Game modes differ
- **WHEN** a later request has the same map and queue kind but a different game mode from a follow-up
- **THEN** it does not join that follow-up

#### Scenario: Queue kinds differ
- **WHEN** a later Ordinary request has the same mode and map as a Priority follow-up
- **THEN** it does not join the Priority raid

### Requirement: Small request lifecycle
Request state SHALL be `waiting`, `planned`, `completed`, or `canceled`. Helped requests become completed. Postponed requests remain active.

#### Scenario: Requester is postponed
- **WHEN** the raid leader postpones one requester
- **THEN** the request remains planned in the next follow-up raid

#### Scenario: Requester is removed
- **WHEN** the raid leader removes one requester
- **THEN** the request becomes canceled and automatic materialization cannot add it to another raid
