## ADDED Requirements

### Requirement: Public documentation uses Simplified Technical English
README, operator guides, streamer guides, security and contribution files, GitHub templates, workflow labels, and release instructions SHALL use ASD-STE100 Simplified Technical English. The canonical MIT license text SHALL remain unchanged.

#### Scenario: Public documentation changes
- **WHEN** a contributor changes a public-facing document
- **THEN** automated mechanical checks and human STE review are required before release

### Requirement: Instructions identify role and source
Each setup value and action SHALL identify whether the streamer or technical installer performs it. Each GitHub variable and secret SHALL state its exact name, source platform, visibility, location, and validation method.

#### Scenario: Installer configures the fork
- **WHEN** the installer reads the environment table
- **THEN** the installer can enter every required value without deriving an undocumented name or source

### Requirement: Warnings precede risky actions
Public recovery and deployment instructions SHALL put warnings before database restoration, credential rotation, or any action that can interrupt service or discard data.

#### Scenario: Operator reads D1 recovery instructions
- **WHEN** the restore procedure can overwrite live data
- **THEN** the data-loss warning appears before the restore command or control
