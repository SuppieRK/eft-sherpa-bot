# Cross-Platform Commands Specification

## Purpose

Define the shared viewer commands, Discord identity association, response formatting, and inbound-delivery safety.

## Requirements

### Requirement: Shared public command words
Discord SHALL expose `/request` and `/queue`. Twitch SHALL expose `!request` and `!queue`. Queue SHALL accept no arguments. `/position`, `!position`, and `/spike` SHALL NOT be registered public commands.

#### Scenario: Queue is checked on either platform
- **WHEN** `/queue` or `!queue` is invoked
- **THEN** the reply contains the authenticated caller's next global position when one exists

#### Scenario: Caller has no request
- **WHEN** a caller without an active request checks queue
- **THEN** the bot returns only short platform-specific request guidance without revealing another viewer

### Requirement: Queue reports personal global position
When the caller has an active request, Queue SHALL report priority-first overall request order, map, projected raids ahead, and other active maps. The ordinal SHALL be the caller request's position across all active requests and SHALL NOT describe a seat within one raid. Priority raids SHALL count ahead of ordinary raids. Queue SHALL omit aggregate request and raid totals, redundant `Queue:` and `You:` labels, internal references, request notes, stable IDs, and identity-link state.

Queue SHALL report an exact ordinal through 100 requests ahead and an exact raid count through 50 raids ahead. If more work precedes the caller, it SHALL report `More than 100 requests ahead` and/or `more than 50 raids ahead` for the capped dimension. The two limits SHALL apply independently and SHALL be identical on Discord and Twitch.

#### Scenario: Caller has several maps
- **WHEN** the caller checks queue with active requests for several maps
- **THEN** the earliest request is described and the other active maps are named

#### Scenario: Ordinary caller waits behind priority work
- **WHEN** an ordinary caller checks queue while priority raids are outstanding
- **THEN** those priority raids are included in the caller's raids-ahead count

#### Scenario: Caller is deep in a large queue
- **WHEN** more than 100 requests or more than 50 raids precede the caller
- **THEN** Queue reports the applicable lower bound without scanning the complete preceding queue

### Requirement: Discord association is one-way
Discord SHALL expose `/link-twitch` with a required Twitch-name string, optional Escape from Tarkov name, and optional native Discord-user selection. Without the user selection it SHALL associate the authenticated caller. Setting the user selection SHALL require the configured streamer or volunteer-sherpa role and SHALL NOT be restricted to the staff channel.

#### Scenario: Viewer links after joining Discord
- **WHEN** a viewer invokes `/link-twitch` without a selected Discord member
- **THEN** the normalized Twitch login is associated with the authenticated Discord caller

#### Scenario: Staff corrects a mapping
- **WHEN** authorized staff selects a Discord member
- **THEN** the stable Discord ID is stored and the ephemeral response does not ping that member

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
