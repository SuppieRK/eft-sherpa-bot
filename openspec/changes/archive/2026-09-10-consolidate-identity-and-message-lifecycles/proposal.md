## Why

Request intake and queue lookup maintain separate Twitch identity rules. Discord actions also repeat message recovery rules. Concentrate these rules without increasing D1 cost or adding hosting requirements.

## What Changes

- Use one identity transition policy for request intake and queue observation. Keep details from an existing unverified target mapping and fill its missing details from the old stable mapping.
- Keep identity changes and request assignment in the same atomic intake batch.
- Concentrate Discord detail message update, missing-message handling, creation, and cleanup. Preserve distinct planned-review and active-raid behavior.
- Add regression tests and verify the full local D1 benchmark before acceptance.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `help-request-tickets`: Apply the same confirmed identity merge rule through both Twitch entry paths.

## Impact

The D1 repository, Discord message lifecycle, integration tests, and local cost evidence change. Existing commands, raid grouping, pull rules, hosting, and published migrations remain unchanged. No remote D1 access, deployment, commit, or push is part of this change.
