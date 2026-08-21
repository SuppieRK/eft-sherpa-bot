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
