## REMOVED Requirements

### Requirement: Stable fair order and postponement priority
**Reason**: Replace retired queue categories and raid-attempt controls with unified service ordering.
**Migration**: Preserve existing records through forward migration 0012 and use the current unified workflow.

## MODIFIED Requirements

### Requirement: Compatible requests fill requester-postponement follow-ups
A planned requester-postponement follow-up SHALL accept later waiting requests for the same game mode and map while requester capacity remains. Automatic filling SHALL preserve existing memberships and manual service placement.

#### Scenario: Compatible request follows an individual postponement
- **WHEN** a compatible follow-up has spare capacity and a later request selects the same mode and map
- **THEN** the later request becomes a member of that follow-up instead of creating a separate raid

#### Scenario: Game modes differ
- **WHEN** a later request has the same map but a different game mode from a follow-up
- **THEN** it does not join that follow-up

## ADDED Requirements

### Requirement: Queue-independent request grouping
Every request SHALL retain its immutable arrival identity. New requests SHALL join the earliest eligible unreviewed planned raid in normal grouping order with the same game mode and map and spare capacity, or create one at the unified normal tail. Manual placement SHALL NOT freeze or move memberships. Reviewed groups SHALL remain frozen. Postponed requests SHALL remain active, preserving identity and arrival sequence.

#### Scenario: New request joins a pinned group
- **WHEN** a pinned unreviewed compatible raid has capacity
- **THEN** intake can fill it without changing its manual service placement

#### Scenario: Reviewed pinned group has capacity
- **WHEN** a compatible request arrives after Review
- **THEN** the existing frozen group receives no automatic member
