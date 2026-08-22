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
The system SHALL verify platform signatures and a ten-minute timestamp window before parsing private data. It SHALL retain completed delivery protection for 24 hours and purge expired receipts only through bounded leased background maintenance. Discord request creation SHALL use its source-delivery uniqueness instead of storing a redundant mutation receipt. Every other Discord mutation SHALL either commit its completion receipt atomically with the guarded D1 mutation or retain an incomplete retryable receipt until the durable mutation succeeds. Twitch SHALL check for an exact stored delivery before it performs command-side D1 work, SHALL store a new reply with the command result atomically, and SHALL permit only the stored winner to send a reply or synchronize the board. A failed Twitch reply SHALL remain eligible for one atomically claimed retry.

#### Scenario: Discord request modal repeats
- **WHEN** Discord repeats the same valid request-modal delivery
- **THEN** source-delivery uniqueness returns the existing request without a separate Discord receipt or duplicate queue state

#### Scenario: Discord mutation fails after it is claimed
- **WHEN** a guarded Discord mutation fails before its durable state commits
- **THEN** a later exact delivery can reclaim or retry it and the failed attempt is not recorded as complete

#### Scenario: Discord reclaims an abandoned exact delivery
- **WHEN** the wall-clock claim lease expires and another Worker reclaims the same signed interaction
- **THEN** the new random claim token fences completion and release so the stale Worker cannot alter the newer claim

#### Scenario: Discord mutation repeats after commit
- **WHEN** a completed Discord mutation delivery repeats
- **THEN** it does not apply the state transition or its external effect again

#### Scenario: Twitch delivery repeats after its receipt exists
- **WHEN** a committed Twitch delivery is received again
- **THEN** the Worker reads the stored reply state before command processing and performs no repeated identity, request, queue, or board mutation work

#### Scenario: Twitch delivery overlaps while reply is pending
- **WHEN** several copies of one signed Twitch command overlap before the first reply finishes
- **THEN** the stored winning receipt permits at most one platform reply and one canonical-board synchronization

#### Scenario: Twitch command processing claim is abandoned
- **WHEN** a Worker stops after claiming a Twitch command but before storing its reply
- **THEN** a later exact delivery can reclaim the expired processing lease and rerun the idempotent command work

#### Scenario: Twitch send acknowledgement is ambiguous
- **WHEN** Twitch may have accepted a reply but the Worker cannot durably record success
- **THEN** the stored send token suppresses automatic resend and the system records safe diagnostic evidence instead of risking a duplicate message

#### Scenario: Failed Twitch reply is retried concurrently
- **WHEN** several repeated deliveries observe the same failed Twitch reply
- **THEN** one delivery atomically claims and retries the stored reply

#### Scenario: A valid signature has a stale timestamp
- **WHEN** a Discord or Twitch delivery is outside the ten-minute replay window
- **THEN** the system rejects it before parsing or storing the delivery

#### Scenario: An old receipt passes retention
- **WHEN** receipt maintenance runs more than 24 hours after that receipt was accepted
- **THEN** the bounded background batch can delete it while recent duplicate protection remains active

### Requirement: Twitch commands perform only required grouping work
Twitch SHALL materialize waiting requests after a valid `!request` is stored and immediately before `!queue` reads queue facts. An invalid `!request` SHALL return guidance without materializing waiting requests. A valid request path SHALL NOT materialize before request creation.

#### Scenario: Valid Twitch request is accepted
- **WHEN** a viewer submits a valid `!request`
- **THEN** the request is stored and one post-create materialization pass includes it and any earlier waiting backlog

#### Scenario: Invalid Twitch request is rejected
- **WHEN** a viewer submits an invalid `!request`
- **THEN** the bot returns guidance without reading or changing raid grouping

#### Scenario: Twitch queue is checked
- **WHEN** a viewer invokes `!queue`
- **THEN** waiting requests are materialized before the viewer's queue facts are read

### Requirement: Raid calls are best-effort background deliveries
After the raid start commits, the system SHALL return the Discord interaction response and SHALL attempt Discord and Twitch call delivery concurrently through tracked `waitUntil()` work. It SHALL NOT retry a failed or ambiguous raid call. Platform delivery outcome and best-effort D1 status persistence SHALL use separate error handling so a successful platform send is not recorded as a platform failure solely because its status write fails.

#### Scenario: Both platform calls are available
- **WHEN** staff start a raid containing Discord and Twitch recipients
- **THEN** the interaction response is not delayed by delivery and both platform sends begin as concurrent background work

#### Scenario: Sent status cannot be stored
- **WHEN** a platform accepts a raid call but D1 rejects the later `sent` status update
- **THEN** the system logs the status-write failure without recording a platform failure or sending the call again

#### Scenario: Platform call fails
- **WHEN** Discord or Twitch rejects a raid call
- **THEN** the system attempts one best-effort `failed` status write and does not retry the platform call
