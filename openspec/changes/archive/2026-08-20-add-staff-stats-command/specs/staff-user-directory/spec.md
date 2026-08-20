## ADDED Requirements

### Requirement: Staff can inspect Twitch-first user identity state
Discord SHALL expose `/users` only to the configured streamer and current volunteer sherpas in the configured staff channel. It SHALL list retained `user_mappings` records in normalized Twitch-login order. Each row SHALL show the Twitch login, whether a stable Twitch user ID has been observed, the linked Discord member or `Not linked (optional)`, and the stored Escape from Tarkov name or `Missing`. Leader and member mentions SHALL render without sending notifications.

The command SHALL NOT call the list a mandatory registration, require a Discord link, or expose a user record to an unauthorized caller. It SHALL NOT expose stable Twitch or Discord numeric IDs as plain text.

#### Scenario: Staff inspect a complete identity
- **WHEN** an authorized caller views a user with observed Twitch identity, linked Discord member, and Escape from Tarkov name
- **THEN** the row shows the Twitch login, observed Twitch state, rendered Discord member, and in-game name without pinging the member

#### Scenario: Optional identity details are absent
- **WHEN** a retained Twitch login has no stable Twitch ID, Discord link, or Escape from Tarkov name
- **THEN** the row labels Twitch as not yet observed, Discord as optional and not linked, and the in-game name as missing

#### Scenario: Unauthorized caller invokes users
- **WHEN** a caller is neither the configured streamer nor a current volunteer sherpa
- **THEN** the bot returns only a short ephemeral denial and reveals no user record or aggregate user count

#### Scenario: Authorized caller invokes users outside the staff channel
- **WHEN** the configured streamer or a current volunteer sherpa invokes `/users` outside the configured staff channel
- **THEN** the bot returns only a short ephemeral denial and reveals no user record or aggregate user count

### Requirement: User pages use bounded stateless pagination
`/users` SHALL return one ephemeral embed containing at most ten users. It SHALL use stable Twitch-login keyset order and stateless Previous and Next buttons that encode only the version, direction, and page boundary needed to query the adjacent page. It SHALL NOT store page state or message identity in D1 and SHALL NOT use SQL `OFFSET`.

The first page SHALL disable Previous. The last page SHALL disable Next. A page SHALL also expose one `Complete user details` selector containing only displayed users whose Discord member or Escape from Tarkov name is missing; it SHALL be disabled when the page has no editable missing detail. A page interaction SHALL reauthorize the caller and configured staff channel, read current mapping state, and replace the same ephemeral response. Inserted, updated, or removed mappings MAY change later pages without corrupting the stable order.

#### Scenario: More than ten users exist
- **WHEN** authorized staff invoke `/users` with more than ten retained mappings
- **THEN** the first ten Twitch logins appear in stable order, Previous is disabled, and Next is available

#### Scenario: Staff move to the next page
- **WHEN** authorized staff select Next
- **THEN** the same ephemeral response shows at most the next ten Twitch logins and offers valid adjacent-page controls

#### Scenario: Staff return to the previous page
- **WHEN** authorized staff select Previous from a later page
- **THEN** a descending keyset read is reversed for display and the same response shows the preceding Twitch-login page in ascending order

#### Scenario: Directory state changes between pages
- **WHEN** a mapping is added or corrected after one page was rendered
- **THEN** the next interaction queries current D1 state from its encoded boundary without relying on stored session state

#### Scenario: Page has incomplete users
- **WHEN** at least one displayed mapping lacks a Discord member or Escape from Tarkov name
- **THEN** the completion selector lists those Twitch logins and excludes complete displayed mappings

### Requirement: Staff can add missing directory details
Selecting an incomplete user SHALL replace the page with a caller-only detail view for that Twitch login. When Discord is missing, the view SHALL expose a native Discord user selector. When the Escape from Tarkov name is missing, it SHALL expose an `Add EFT name` button that opens a modal with a required 1–64 character field. It SHALL expose `Back to users` and encode enough bounded cursor state to reconstruct the originating page without a stored session.

Each mutation SHALL reauthorize the caller, claim the Discord interaction idempotently, and atomically update only a field that is still missing. A uniqueness conflict, completed field, malformed component, missing mapping, or concurrent update SHALL change nothing and return short restart guidance. After success, the same ephemeral detail view SHALL show current state and remove the completed field's control. It SHALL NOT send a user notification.

Every directory view SHALL explain that a stable Twitch user ID is observed automatically when the viewer uses the bot on Twitch. It SHALL surround `/link-twitch` with inline code when identifying the existing command for corrections. `/users` SHALL NOT overwrite a present Discord member or Escape from Tarkov name, add manual Twitch-ID input, or become a general profile editor.

#### Scenario: Staff find missing Discord or game details
- **WHEN** staff select a displayed user without a Discord link and Escape from Tarkov name
- **THEN** the detail view offers a native Discord user selector, an `Add EFT name` button, and `Back to users`

#### Scenario: Staff add a missing Discord member
- **WHEN** authorized staff select a Discord member for an identity whose Discord field is still absent
- **THEN** the mapping stores that Discord member and display name, the detail view refreshes without the Discord selector, and no mention notification is sent

#### Scenario: Staff add a missing game name
- **WHEN** authorized staff submit a valid Escape from Tarkov name for an identity whose in-game field is still absent
- **THEN** the mapping stores the trimmed name and the detail view refreshes without the add-name button

#### Scenario: Another action fills the field first
- **WHEN** a missing-detail interaction commits after another action has already populated that field
- **THEN** the later interaction changes nothing and tells staff to reopen `/users`

#### Scenario: Staff need to correct a present detail
- **WHEN** a directory row contains an incorrect but non-empty Discord member or Escape from Tarkov name
- **THEN** `/users` does not overwrite it and the view identifies `/link-twitch` as the correction command

#### Scenario: Stable Twitch ID is absent
- **WHEN** a page shows that Twitch identity has not been observed
- **THEN** the guidance tells staff that the viewer must use the bot on Twitch and does not offer manual ID entry
