## MODIFIED Requirements

### Requirement: Twitch commands perform only required grouping work
Valid Twitch request creation SHALL atomically store the request as planned with exactly one open membership in an eligible raid. Routine Twitch request and queue commands SHALL NOT scan or materialize unrelated waiting requests. Invalid Twitch request guidance SHALL perform no D1 work. Legacy unassigned requests SHALL be repaired only through the authenticated operator repair path.

#### Scenario: Valid Twitch request is accepted
- **WHEN** a viewer submits a valid new `!request`
- **THEN** the request and its eligible raid membership are committed atomically without materializing any unrelated waiting backlog

#### Scenario: Invalid Twitch request is rejected
- **WHEN** a viewer submits an invalid `!request`
- **THEN** the bot returns best-effort guidance without any D1 statement, identity update, receipt, or grouping work

#### Scenario: Twitch queue is checked
- **WHEN** a viewer invokes `!queue`
- **THEN** the bot observes the caller's identity and reads bounded queue facts without materializing waiting requests

#### Scenario: Legacy waiting requests remain
- **WHEN** an operator invokes the authenticated legacy repair path
- **THEN** the existing bounded repair workflow assigns those requests without adding repair work to viewer commands
