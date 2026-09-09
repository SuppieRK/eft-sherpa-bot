## ADDED Requirements

### Requirement: Identity merge is consistent across Twitch entry paths

Valid Twitch request intake and queue identity observation SHALL apply the same stable-identity merge rule. If a stable Twitch identity changes to a login with an unverified mapping, the target mapping SHALL retain its present Discord and Escape from Tarkov details and receive missing details from the old mapping. The old identity's request links SHALL follow the merged identity where active-request uniqueness permits. A target with a different verified Twitch ID SHALL remain a conflict. Older observations SHALL NOT replace newer identity data. Request intake SHALL commit the identity transition and request assignment atomically, without a separately committed observation workflow.

#### Scenario: New login already has an unverified mapping

- **WHEN** either valid Twitch entry path observes that new login for an existing stable identity
- **THEN** both paths retain the same target details, fill the same missing details, and preserve the old stable identity's request access

#### Scenario: Target has another verified identity

- **WHEN** either path observes a target linked to a different verified Twitch ID
- **THEN** the operation rejects the conflict without transferring profile details

#### Scenario: Intake assignment fails after a merge

- **WHEN** request assignment fails in the intake batch
- **THEN** the identity merge and new request roll back together

#### Scenario: Old delivery arrives after a rename

- **WHEN** either path receives an older identity observation
- **THEN** it retains the newer stable login and observation time
