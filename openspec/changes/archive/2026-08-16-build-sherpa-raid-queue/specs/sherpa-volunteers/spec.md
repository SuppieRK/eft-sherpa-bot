## ADDED Requirements

### Requirement: Discord role defines volunteer access
The configured Discord role SHALL determine who can operate the staff board and who can be selected as a volunteer leader. The system SHALL NOT store volunteer profiles.

#### Scenario: Current volunteer uses the board
- **WHEN** a current role member invokes `/board` in the staff channel
- **THEN** the system allows the staff workflow

#### Scenario: Non-member uses the board
- **WHEN** a user is neither the streamer nor a current role member
- **THEN** the system denies access and reveals no request notes

### Requirement: Volunteer may lead alone
One eligible volunteer SHALL be able to lead a raid without streamer participation.

#### Scenario: Volunteer is selected
- **WHEN** a current volunteer-role member starts a planned raid
- **THEN** that caller becomes the leader and the group remains valid subject to its map capacity
