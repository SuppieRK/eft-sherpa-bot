## MODIFIED Requirements

### Requirement: Discord association is one-way
Discord SHALL expose `/link-twitch` with a required Twitch-name string, optional Escape from Tarkov name, and optional native Discord-user selection. Without the user selection it SHALL associate the authenticated caller only when the mapping has no Discord member or already has that caller. Replacing a different existing Discord member SHALL require the configured streamer or volunteer-sherpa role, even when the command has no user selection. Setting the user selection SHALL require the same staff authority and SHALL NOT be restricted to the staff channel. Discord request submission SHALL enforce the same attachment policy. Rejected attachment SHALL leave identity fields and requests unchanged and ask the caller to contact staff.

The staff-only `/users` workflow SHALL also permit authorized staff to add a Discord member or Escape from Tarkov name only when that field is missing from an existing Twitch-first mapping. It SHALL NOT overwrite a present value or accept a manually entered Twitch user ID. `/link-twitch` SHALL remain the command for intentional corrections.

#### Scenario: Viewer links after joining Discord
- **WHEN** a viewer invokes `/link-twitch` without a selected Discord member and the target has no other Discord member
- **THEN** the normalized Twitch login is associated with the authenticated caller

#### Scenario: Staff corrects a mapping
- **WHEN** authorized staff selects a Discord member through `/link-twitch`
- **THEN** the stable Discord ID is stored and the ephemeral response does not ping that member

#### Scenario: Staff complete a missing directory field
- **WHEN** authorized staff use `/users` to add a missing Discord member or Escape from Tarkov name
- **THEN** only the selected absent field is populated and existing identity values remain unchanged

#### Scenario: Public caller selects an already linked name
- **WHEN** a public link command or request submission uses a Twitch login associated with a different Discord member
- **THEN** the command asks for staff help and does not change either member's identity or create a request
