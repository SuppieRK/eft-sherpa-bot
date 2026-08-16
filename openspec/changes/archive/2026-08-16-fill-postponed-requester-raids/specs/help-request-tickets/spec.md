## ADDED Requirements

### Requirement: Compatible requests fill requester-postponement follow-ups
A planned requester-postponement follow-up SHALL accept later waiting requests for the same map and queue kind while requester capacity remains. Automatic filling SHALL preserve existing memberships and SHALL NOT promote an Ordinary request into Priority.

#### Scenario: Same-map request follows an individual postponement
- **WHEN** an Ordinary follow-up has spare capacity and a later Ordinary request selects the same map
- **THEN** the later request becomes a member of that follow-up instead of creating a separate raid

#### Scenario: Queue kinds differ
- **WHEN** a later Ordinary request has the same map as a Priority follow-up
- **THEN** it does not join the Priority raid
