## MODIFIED Requirements

### Requirement: Discord role defines volunteer access
The configured Discord role SHALL determine who can operate the staff board, view staff statistics and the staff user directory in the configured staff channel, and be selected as a volunteer leader. The configured streamer SHALL also be authorized for the board, statistics, and user directory in that channel. The system SHALL NOT store volunteer profiles.

#### Scenario: Current volunteer uses the board
- **WHEN** a current role member invokes `/board` in the staff channel
- **THEN** the system allows the staff workflow

#### Scenario: Current volunteer views statistics
- **WHEN** a current role member invokes `/stats` in the staff channel
- **THEN** the system returns the caller-only statistics embed

#### Scenario: Streamer views statistics
- **WHEN** the configured streamer invokes `/stats` in the staff channel
- **THEN** the system returns the caller-only statistics embed without requiring the volunteer role

#### Scenario: Staff view the user directory
- **WHEN** the configured streamer or a current volunteer-role member invokes `/users` in the staff channel
- **THEN** the system returns the caller-only paginated user directory

#### Scenario: Non-member uses a staff command
- **WHEN** a user is neither the streamer nor a current volunteer-role member and invokes `/board`, `/stats`, or `/users`
- **THEN** the system denies access and reveals no request, raid, leader, or identity data
