## ADDED Requirements

### Requirement: Twitch identity persistence follows accepted command work
The system SHALL persist authenticated Twitch identity once through valid Twitch request creation and SHALL observe authenticated Twitch identity before a Twitch queue lookup. It SHALL NOT create or update a user mapping for an invalid Twitch request. A request command SHALL materialize the raid board only when the returned request remains waiting.

#### Scenario: Valid Twitch request is created
- **WHEN** a viewer submits a valid `!request` command
- **THEN** request creation performs the identity mapping workflow once and materializes the request when it remains waiting

#### Scenario: Invalid Twitch request is rejected
- **WHEN** a viewer submits a malformed or invalid `!request` command
- **THEN** the bot returns guidance without creating or updating a user mapping or materializing the raid board

#### Scenario: Twitch queue is checked
- **WHEN** a viewer submits `!queue`
- **THEN** the bot observes the authenticated Twitch identity before it resolves and renders that viewer's queue state

#### Scenario: Duplicate request is already planned
- **WHEN** a duplicate Twitch delivery resolves to a request that is no longer waiting
- **THEN** the bot reuses the stored reply state without running request materialization again

#### Scenario: Duplicate request stopped before assignment
- **WHEN** a duplicate Twitch delivery resolves to a request that remains waiting after an earlier interrupted invocation
- **THEN** the bot runs bounded materialization so the committed request can recover
