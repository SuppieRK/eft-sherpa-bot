## ADDED Requirements

### Requirement: Discord mutation completion failures retain the claim

Discord Twitch-link edits, missing-Discord edits, missing-EFT-name edits, and staff raid actions SHALL use the same receipt lifecycle. If the guarded action returns successfully but saving receipt completion fails, the Worker SHALL retain the pending claim until its existing lease expires. It SHALL NOT release that claim immediately or retry the action automatically. An action failure before it returns SHALL release its claim using the existing token predicate. Expected staff domain rejections SHALL return the existing private response and complete the receipt. Cleanup SHALL run as tracked background work only after successful receipt completion.

#### Scenario: Completion storage fails after an action succeeds

- **WHEN** an action returns successfully and the receipt completion write fails
- **THEN** the pending claim remains and an exact delivery before lease expiry does not execute the action again

#### Scenario: Guarded action fails

- **WHEN** the guarded action throws an infrastructure error before returning
- **THEN** the Worker releases its claim with its token and permits an exact delivery to retry

#### Scenario: Staff action is rejected

- **WHEN** staff select an action that raises an expected domain rejection
- **THEN** the Worker returns the existing private guidance and completes the receipt without applying the rejected transition

#### Scenario: Cleanup fails after completion

- **WHEN** receipt completion succeeds and background cleanup fails
- **THEN** the action response and completed receipt remain successful and background telemetry records the failure

#### Scenario: Pending claim expires

- **WHEN** the existing wall-clock claim lease expires after completion storage failed
- **THEN** a later valid exact delivery can reclaim it using the existing random-token fencing rules
