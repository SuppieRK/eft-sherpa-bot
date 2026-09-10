## Context

The Worker uses one D1 database. Request intake commits identity, request, and raid assignment together. Queue lookup observes the same Twitch identity through a separate implementation. Discord review, pull, and reconciliation repeat message creation and recovery rules.

## Goals / Non-Goals

**Goals:**

- Concentrate identity decisions and message lifecycle decisions.
- Apply the confirmed merge rule through both Twitch paths.
- Preserve atomic intake and bounded SQL, including bulk board hydration.
- Keep measured D1 cost unchanged or lower for existing benchmark cases.

**Non-Goals:**

- New commands, hosting, dependencies, migrations, outboxes, or guaranteed calls.
- Generic repository abstractions or a full repository rewrite.
- Changes to pull eligibility, capacity, attempts, or queue order.

## Decisions

### Identity transitions stay inside the caller's transaction

A D1 identity module owns stable identity resolution, observation ordering, collision checks, mapping writes, and optional-detail merge statements. It supplies statements to intake rather than committing a separate observation first. Queue observation uses the same resolution and merge policy. The target mapping retains present optional details and receives missing details from the old stable mapping. A different verified target identity remains a conflict.

Keep the existing common-path statement budget. Do not introduce a generic identity repository or an additional pre-intake observation workflow.

### One owner for Discord message lifecycle

A Discord lifecycle module owns update, missing-message handling, compare-and-set creation, and duplicate cleanup. Review, pull, and visible reconciliation use it. Explicit Review can create a message when no reference exists. A missing planned review is dismissed without replacement. Active details can recover. Terminal deletion remains best-effort with existing staff guidance.

Move canonical board drain orchestration into the same lifecycle area where this removes handler knowledge, but preserve its existing lease and snapshot protocol. Keep bulk candidate loading outside per-message operations and pass prepared message content into the lifecycle. Keep tracked background work and no retry policy for raid calls.

### Verification uses real local D1

Add paired identity tests through both entry paths before consolidation. Cover target-detail precedence, missing details, delayed events, verified collisions, request links, and transaction failure. Retain complete Discord workflow tests for multiple details, manual deletion, stale controls, compare-and-set races, and storage failures. Run the full test suite, static checks, build, and fully local benchmark. Review exact counter differences before updating the baseline. Do not raise approved maximum budgets.

## Risks / Trade-offs

- Shared identity statements can change statement order: keep assignment atomic and test rollback.
- Similar Discord operations have different recovery policies: use explicit review/active behavior and preserve regression scenarios.
- Additional reads can erase refactor value: require unchanged or reduced existing operation costs and retain bulk reads.
- Published specs contain old pilot capacity text: follow the confirmed configured limit of four, capped at map capacity minus one, without altering capacity in this change.

## Migration Plan

No schema change. Run local verification before any later user-authorized deployment. Existing stored records and published migrations remain unchanged.

## Open Questions

None. The user confirmed both refactors and target-first optional-detail merging for both identity paths.
