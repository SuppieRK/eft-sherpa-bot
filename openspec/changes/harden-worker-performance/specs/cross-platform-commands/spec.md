## ADDED Requirements

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

## MODIFIED Requirements

### Requirement: Inbound commands are authenticated and idempotent
The system SHALL verify platform signatures and a ten-minute timestamp window before parsing private data. It SHALL deduplicate mutating deliveries in `event_receipts`, retain receipts for 24 hours, and purge older receipts during later claims. Overlapping copies of one Twitch delivery SHALL schedule at most one platform reply and one canonical-board synchronization for each delivery attempt. A failed Twitch reply SHALL remain eligible for one atomically claimed retry.

#### Scenario: Signed delivery repeats
- **WHEN** a committed Discord or Twitch delivery is received again
- **THEN** it creates no duplicate state and an unsent Twitch reply may be retried

#### Scenario: Twitch delivery overlaps while reply is pending
- **WHEN** several copies of one signed Twitch command are processed before its first reply finishes
- **THEN** one copy sends the reply and synchronizes the board while the other copies complete without repeating external work

#### Scenario: Failed Twitch reply is retried concurrently
- **WHEN** several repeated deliveries observe the same failed Twitch reply
- **THEN** one delivery atomically claims and retries the stored reply

#### Scenario: A valid signature has a stale timestamp
- **WHEN** a Discord or Twitch delivery is outside the ten-minute replay window
- **THEN** the system rejects it before parsing or storing the delivery

#### Scenario: An old receipt passes retention
- **WHEN** a later Discord or Twitch delivery is claimed more than 24 hours after that receipt
- **THEN** the old receipt is deleted while recent duplicate protection remains active
