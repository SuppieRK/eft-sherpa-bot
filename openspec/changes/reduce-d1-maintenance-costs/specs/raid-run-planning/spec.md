## MODIFIED Requirements

### Requirement: New requests are assigned atomically
Every accepted new help request SHALL commit as a planned request with exactly one open membership. The transaction SHALL fill the earliest eligible compatible unreviewed planned raid with capacity or create one new raid at the correct queue tail. Compatibility SHALL require the same game mode, map, and queue kind. The transaction SHALL enforce configured requester capacity and SHALL leave no committed active request without an open membership.

#### Scenario: A compatible raid has capacity
- **WHEN** a valid request matches an automatically fillable planned raid
- **THEN** the transaction adds the requester to that earliest raid at the next contiguous position

#### Scenario: No compatible raid has capacity
- **WHEN** a valid request has no eligible destination
- **THEN** the transaction creates one compatible queue-tail raid and adds the requester to it

#### Scenario: A reviewed or active raid has capacity
- **WHEN** a valid request matches a raid that is reviewed, reserved, or active
- **THEN** automatic intake does not modify that raid and uses another eligible raid or creates one

#### Scenario: Compatible requests arrive concurrently
- **WHEN** concurrent requests target the same mode, map, and queue kind
- **THEN** each request receives one unique contiguous membership without exceeding requester capacity

### Requirement: Board Refresh reuses one consistent snapshot
The Discord board Refresh action SHALL read one complete board snapshot and use that snapshot for the interaction response, visible raid-detail reconciliation, and canonical-board update. It SHALL NOT assign or repair help requests. Reconciliation MAY re-read an individual visible raid to validate its current detail-message state, but SHALL NOT reload the complete board during the same Refresh action.

#### Scenario: Staff refresh the current board
- **WHEN** eligible staff select `Refresh`
- **THEN** the interaction and canonical message receive the same current board payload and current-version controls from one D1 snapshot

#### Scenario: A visible raid detail needs reconciliation
- **WHEN** the snapshot contains a reviewed or active raid with stored details
- **THEN** the bot validates that raid independently without loading another complete board snapshot

#### Scenario: A detail message changes during reconciliation
- **WHEN** detail reconciliation clears or replaces a stored Discord message identity
- **THEN** the queue contents and controls rendered from the Refresh snapshot remain valid because detail identity does not change raid eligibility or membership
