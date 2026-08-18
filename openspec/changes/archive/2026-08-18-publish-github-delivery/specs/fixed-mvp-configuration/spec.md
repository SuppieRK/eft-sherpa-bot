## MODIFIED Requirements

### Requirement: One deployed community configuration
The MVP SHALL load public Twitch, Discord, infrastructure, and policy values for one community from validated Worker variables rendered from the selected GitHub deployment environment. Credentials SHALL remain in ignored local files, Cloudflare secrets, or GitHub environment secrets. No streamer-specific platform ID SHALL require a tracked fork change.

#### Scenario: Configuration is incomplete
- **WHEN** a live webhook has a missing or malformed deployment value
- **THEN** the operation is blocked before durable state changes and deployment validation reports the invalid variable name

### Requirement: Attempt limit is configurable
The fixed MVP policy SHALL load one positive integer attempt limit from deployment configuration and SHALL document three as the production default.

#### Scenario: Third attempt is active under the default
- **WHEN** two unsuccessful attempts have been recorded with the default attempt limit
- **THEN** the raid message removes the unsuccessful outcome and offers only `Helped` and `Postpone raid`
