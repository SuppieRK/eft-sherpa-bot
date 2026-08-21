## MODIFIED Requirements

### Requirement: Twitch identity persistence follows accepted command work
The system SHALL persist authenticated Twitch identity once through valid Twitch request creation and SHALL observe authenticated Twitch identity before a Twitch queue lookup. It SHALL NOT create or update a user mapping for an invalid Twitch request. Valid request creation SHALL atomically commit the request as planned with exactly one open membership in an eligible raid. Discord board synchronization SHALL run only when request processing creates or repairs a queue assignment.

#### Scenario: Valid Twitch request is created
- **WHEN** a viewer submits a valid `!request` command with no active request for that mode and map
- **THEN** one transaction stores the identity, planned request, compatible raid when needed, and one open membership before scheduling Discord board synchronization

#### Scenario: Invalid Twitch request is rejected
- **WHEN** a viewer submits a malformed or invalid `!request` command
- **THEN** the bot returns guidance without creating or updating a user mapping, assigning requests, reading the raid board, or calling Discord

#### Scenario: Twitch queue is checked
- **WHEN** a viewer submits `!queue`
- **THEN** the bot observes the authenticated Twitch identity before it resolves and renders that viewer's planned queue state without assigning requests or synchronizing Discord

#### Scenario: Duplicate request is already planned
- **WHEN** a duplicate Twitch delivery resolves to a planned request with an open membership
- **THEN** the bot reuses the stored request without creating another raid or membership and without synchronizing Discord

#### Scenario: Legacy duplicate stopped before assignment
- **WHEN** a duplicate delivery resolves to a previous-Worker state-`0` request
- **THEN** the same transactional intake operation assigns and plans that request and reports that the queue changed

#### Scenario: Request assignment fails
- **WHEN** a compatible membership cannot be committed
- **THEN** the identity, request, raid, and membership transaction rolls back and no active request without an open membership remains
