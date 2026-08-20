# Cross-Platform Commands Specification

## Purpose

Define the shared viewer commands, Discord identity association, response formatting, and inbound-delivery safety.
## Requirements
### Requirement: Shared public command words
Discord SHALL expose `/request` with a required game-mode choice and `/queue` to viewers. Discord SHALL also expose `/stats` and `/users` as staff-only commands that operate only in the configured staff channel. Twitch SHALL expose `!request [mode] [map] [goal]` and `!queue`; it SHALL NOT expose `!stats` or `!users`. Queue SHALL accept no arguments. `/position`, `!position`, and `/spike` SHALL NOT be registered public commands.

#### Scenario: Queue is checked on either platform
- **WHEN** `/queue` or `!queue` is invoked
- **THEN** the reply contains the authenticated caller's next mode-scoped position when one exists

#### Scenario: Caller has no request
- **WHEN** a caller without an active request checks queue
- **THEN** the bot returns only short platform-specific request guidance without revealing another viewer

#### Scenario: Request omits game mode
- **WHEN** a viewer attempts to submit a request without selecting or typing a supported mode
- **THEN** no request is created and the bot gives short guidance for PvP Seasonal, PvP, and PvE

#### Scenario: Staff requests statistics in Discord
- **WHEN** the configured streamer or a current volunteer sherpa invokes `/stats` in the configured staff channel
- **THEN** Discord routes the command to the staff statistics workflow

#### Scenario: Staff requests users in Discord
- **WHEN** the configured streamer or a current volunteer sherpa invokes `/users` in the configured staff channel
- **THEN** Discord routes the command to the staff user-directory workflow

#### Scenario: Staff command is used outside the staff channel
- **WHEN** the configured streamer or a current volunteer sherpa invokes `/stats` or `/users` outside the configured staff channel
- **THEN** the bot returns only a short ephemeral denial and does not reveal statistics or identity data

#### Scenario: Viewer types a staff command in Twitch
- **WHEN** a Twitch viewer sends `!stats` or `!users`
- **THEN** the bot treats it as ordinary chat and sends no command reply

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

### Requirement: Discord association is one-way
Discord SHALL expose `/link-twitch` with a required Twitch-name string, optional Escape from Tarkov name, and optional native Discord-user selection. Without the user selection it SHALL associate the authenticated caller. Setting the user selection SHALL require the configured streamer or volunteer-sherpa role and SHALL NOT be restricted to the staff channel.

The staff-only `/users` workflow SHALL also permit authorized staff to add a Discord member or Escape from Tarkov name only when that field is missing from an existing Twitch-first mapping. It SHALL NOT overwrite a present value or accept a manually entered Twitch user ID. `/link-twitch` SHALL remain the command for intentional corrections.

#### Scenario: Viewer links after joining Discord
- **WHEN** a viewer invokes `/link-twitch` without a selected Discord member
- **THEN** the normalized Twitch login is associated with the authenticated caller

#### Scenario: Staff corrects a mapping
- **WHEN** authorized staff selects a Discord member through `/link-twitch`
- **THEN** the stable Discord ID is stored and the ephemeral response does not ping that member

#### Scenario: Staff complete a missing directory field
- **WHEN** authorized staff use `/users` to add a missing Discord member or Escape from Tarkov name
- **THEN** only the selected absent field is populated and existing identity values remain unchanged

### Requirement: Discord command references use inline code
Every Discord bot reply that refers to a slash command SHALL surround the complete command reference with backticks.

#### Scenario: Board access is denied
- **WHEN** a caller invokes `/board` outside the authorized staff context
- **THEN** the private guidance renders `/board` as inline code

### Requirement: Inbound commands are authenticated and idempotent
The system SHALL verify platform signatures and a ten-minute timestamp window before parsing private data. It SHALL deduplicate mutating deliveries in `event_receipts`, retain receipts for 24 hours, and purge older receipts during later claims.

#### Scenario: Signed delivery repeats
- **WHEN** a committed Discord or Twitch delivery is received again
- **THEN** it creates no duplicate state and an unsent Twitch reply may be retried

#### Scenario: A valid signature has a stale timestamp
- **WHEN** a Discord or Twitch delivery is outside the ten-minute replay window
- **THEN** the system rejects it before parsing or storing the delivery

#### Scenario: An old receipt passes retention
- **WHEN** a later Discord or Twitch delivery is claimed more than 24 hours after that receipt
- **THEN** the old receipt is deleted while recent duplicate protection remains active
