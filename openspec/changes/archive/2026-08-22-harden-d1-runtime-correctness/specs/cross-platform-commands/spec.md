## MODIFIED Requirements

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

## ADDED Requirements

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
