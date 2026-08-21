## Why

Normal Twitch request handling repeats identity writes, while receipt cleanup and recovery materialization can perform unbounded work during a user command. These paths should have predictable D1 cost without weakening duplicate-delivery recovery, queue fairness, or retained raid history.

## What Changes

- Let valid Twitch requests persist identity once through request creation, reject invalid requests without changing identity data, and observe identity only for queue lookup.
- Materialize a Twitch request only when its returned record is still waiting.
- Bound expired receipt cleanup and waiting-request recovery work per invocation.
- Preserve at least one materialized raid opportunity for each non-empty game mode during backlog recovery.
- Avoid unchanged user-mapping writes and remove the obsolete global request-order index with an additive migration.
- Restrict open board membership reads to current members without hiding completed raid history from historical reads.
- Extend the fully local D1 benchmark with expired-receipt, waiting-backlog, and removed-membership-history stress cases.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `help-request-tickets`: Clarify when Twitch commands persist identity and when request creation triggers raid materialization.
- `mvp-deployment`: Require bounded recovery maintenance, additive index removal, query-plan verification, and adversarial local D1 performance evidence.

## Impact

The change affects Twitch command dispatch, the D1 repository, receipt retention, waiting-request assignment, board hydration, migration `0005`, repository and workflow tests, and the fully local benchmark. Public command syntax and existing request, raid, and identity records remain compatible.
