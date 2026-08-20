## MODIFIED Requirements

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
