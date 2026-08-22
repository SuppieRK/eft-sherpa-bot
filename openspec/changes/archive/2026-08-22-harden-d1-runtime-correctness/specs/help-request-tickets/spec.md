## MODIFIED Requirements

### Requirement: One active request per viewer, mode, and map
The database SHALL enforce at most one waiting or planned request per stable Twitch user ID, game mode, and map when the stable ID is known. It SHALL retain normalized Twitch-login uniqueness as the fallback for requests whose stable ID is unknown. Active-request lookup SHALL prefer stable Twitch user ID over login, and identity observation SHALL retain the active request while updating its current normalized login for later Twitch mentions. A viewer MAY hold active requests for the same map in different modes.

#### Scenario: Active mode and map are requested again
- **WHEN** the same stable Twitch user requests an active mode-and-map pair again under the same or a different login
- **THEN** the existing request and queue order remain unchanged

#### Scenario: Twitch login changes before queue lookup
- **WHEN** Twitch authenticates the same stable user ID with a new login after that user created an active request
- **THEN** `!queue` finds the existing request and later raid calls use the current normalized login

#### Scenario: Discord request resolves a known stable identity
- **WHEN** Discord submits a Twitch login whose mapping contains a stable Twitch user ID
- **THEN** request creation evaluates active uniqueness by that stable ID before it uses login fallback

#### Scenario: Stable Twitch ID is unknown
- **WHEN** a Discord-origin request has no known stable Twitch user ID
- **THEN** the normalized Twitch login, game mode, and map enforce the active-request limit

#### Scenario: Same map is requested in another mode
- **WHEN** the same stable Twitch user requests an active map in a different game mode
- **THEN** a separate request is accepted for that mode without changing the earlier request

#### Scenario: Twitch reassigns a login held by another stable identity
- **WHEN** an authenticated Twitch user ID appears under a login mapped to a different non-null Twitch user ID
- **THEN** the system rejects automatic identity merging and does not transfer either user's Discord or EFT details

## ADDED Requirements

### Requirement: Twitch identity observations are time-monotonic
The system SHALL store the latest accepted authenticated Twitch observation time for a stable identity. Identity observation and Twitch request intake SHALL NOT move or merge that identity from an event older than the stored observation. Equal timestamps SHALL remain idempotent.

#### Scenario: Delayed old login observation arrives
- **WHEN** a newer authenticated event has moved a stable Twitch identity to a new login and an older event later reports the previous login
- **THEN** the mapping, active requests, and Twitch mention login remain on the newer login

#### Scenario: Delayed request delivery arrives
- **WHEN** a delayed valid Twitch request carries an identity observation older than the stored mapping observation
- **THEN** request intake applies active-request rules without reverting the stable identity to the older login
