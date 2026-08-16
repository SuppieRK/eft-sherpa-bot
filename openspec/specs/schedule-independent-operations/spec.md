# Schedule-Independent Operations Specification

## Purpose

Define raid operations that remain available without Twitch schedule or time-based state.

## Requirements

### Requirement: Raid operations are schedule-independent
The system SHALL NOT fetch, store, display, or reconcile Twitch schedule data. Missing or unpublished schedule data SHALL NOT block request materialization, board visibility, raid controls, Discord calls, or Twitch calls.

#### Scenario: Broadcaster publishes no schedule
- **WHEN** requests and staff actions occur without any Twitch schedule
- **THEN** the complete supported workflow remains available

### Requirement: No time-based mutation
The system SHALL NOT use a cron, local date, or stream segment boundary to change request, raid, attempt, or queue state.

#### Scenario: Time advances while raids wait
- **WHEN** planned or active raids remain outstanding across any date boundary
- **THEN** their identities, memberships, attempts, and positions remain unchanged

### Requirement: Schedule endpoint is absent
The Worker SHALL NOT expose `/internal/schedule/refresh` and SHALL NOT register a scheduled trigger for raid operations.

#### Scenario: Removed route is requested
- **WHEN** an operator posts to `/internal/schedule/refresh`
- **THEN** the Worker returns not found
