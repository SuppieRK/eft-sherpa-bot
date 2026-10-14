## MODIFIED Requirements

### Requirement: No time-based mutation
The system SHALL NOT use a cron, local date, or stream segment boundary to change request, raid, or service-order state. Only accepted explicit actions SHALL change those states.

#### Scenario: Time advances while raids wait
- **WHEN** planned or active raids remain outstanding across a date boundary
- **THEN** identities, memberships, and service placements remain unchanged
