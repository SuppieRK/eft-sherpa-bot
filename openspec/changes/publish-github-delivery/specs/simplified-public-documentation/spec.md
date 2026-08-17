## ADDED Requirements

### Requirement: Public documentation uses Simplified Technical English
README, operator guides, streamer guides, security and contribution files, GitHub templates, workflow labels, and release instructions SHALL use ASD-STE100 Simplified Technical English. The canonical MIT license text SHALL remain unchanged.

#### Scenario: Public documentation changes
- **WHEN** a contributor changes a public-facing document
- **THEN** automated mechanical checks and human STE review are required before release

### Requirement: Instructions identify role and source
Each setup value and action SHALL identify whether the streamer or technical installer performs it. Each GitHub variable and secret SHALL state its exact name, GitHub type, source provider, dashboard field or generated field, location, and validation method. The instructions SHALL distinguish numeric platform IDs from login names and credentials from access or refresh tokens.

#### Scenario: Installer configures the fork
- **WHEN** the installer reads the environment table
- **THEN** the installer can enter every required value without deriving an undocumented name or source

#### Scenario: Installer reads generated Twitch values
- **WHEN** the installer adds Twitch IDs and secrets to GitHub
- **THEN** the instructions name the exact authorization output field or ignored local-file key to copy

### Requirement: Warnings precede risky actions
Public recovery and deployment instructions SHALL put warnings before database restoration, credential rotation, or any action that can interrupt service or discard data.

#### Scenario: Operator reads D1 recovery instructions
- **WHEN** the restore procedure can overwrite live data
- **THEN** the data-loss warning appears before the restore command or control
