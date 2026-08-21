## Why

Twitch command handling performs avoidable D1 work, overlapping deliveries can repeat external work, and the current quality gates can miss small D1 cost regressions. Worker cryptographic verification also imports unchanged keys for every webhook instead of reusing safe per-isolate state.

## What Changes

- Materialize waiting requests only when a valid request is created or Queue needs current grouping.
- Make concurrent request materialization converge without duplicate, empty, or over-capacity raids.
- Ensure overlapping Twitch deliveries send one reply per attempt while retaining one retry for a failed reply.
- Cache imported Twitch and Discord cryptographic keys and reuse one text encoder per module.
- Enable production-focused Oxlint performance rules with narrow exceptions for required sequential work.
- Compare deterministic local D1 counters against an exact committed baseline and add invalid-request and concurrency coverage.
- Use a credential-free local workerd workload for before-and-after Worker CPU profiling.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cross-platform-commands`: Restrict Twitch materialization to commands that require it and define overlapping-delivery reply behavior.
- `raid-run-planning`: Require concurrent request submissions to converge on valid capacity-safe grouping.
- `fixed-mvp-configuration`: Require exact committed D1 cost baselines and workerd-based CPU evidence.
- `mvp-deployment`: Extend repository verification with production-focused Oxlint performance analysis.

## Impact

The change affects the Twitch Worker request path, D1 materialization SQL, receipt delivery decisions, webhook cryptographic verification, Oxlint configuration, integration tests, benchmark contracts and reports, developer profiling scripts, and OpenSpec quality requirements. It changes no public command, Discord component, D1 schema, migration, platform permission, production tracing configuration, or external dependency.
