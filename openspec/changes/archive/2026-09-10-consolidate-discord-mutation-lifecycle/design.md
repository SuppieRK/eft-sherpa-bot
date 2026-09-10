## Context

The Worker uses one D1 database. Discord identity edits and staff raid controls repeat claim, completion, release, and tracked cleanup. Completion failures currently release some claims immediately but leave others pending. The user approved a common pending-until-expiry policy after successful actions.

## Goals / Non-Goals

**Goals:** Concentrate receipt ordering in one module, test the failure policy through all four action paths, remove two forwarding classes, and retain current D1 cost budgets.

**Non-Goals:** New commands, schema changes, guaranteed external delivery, autonomous retries, stronger fencing of every business mutation, or a generic transaction framework.

## Decisions

### One receipt lifecycle interface

A Discord mutation module claims a delivery, executes a supplied action, completes the receipt, and schedules tracked cleanup. It returns either a duplicate outcome or the action result. The action cannot access the claim token. SQL remains in the existing D1 repository.

Only action execution belongs in the failure-release scope. Completion stays outside it. If completion fails after the action returns, the receipt remains pending until its existing five-minute lease expires. The module must not run the action again or retry completion automatically. Cleanup runs only after successful completion and uses the measured background environment.

Staff controls translate expected domain rejections into their existing private response inside the action. Thus they still complete their receipt. Infrastructure failures propagate and release the claim. Validation remains before receipt work where it already occurs. Discord request submission retains source-delivery uniqueness without a new receipt.

This gives more depth than moving three forwarding helpers: callers no longer assemble the lifecycle. A generic transaction manager would add an unnecessary interface and would not make external work atomic.

### Delete forwarding query classes only

Call the existing repository query methods from the handlers. Retain domain types, queue caps, useful repository contracts, and response formatting. No query or SQL changes are needed.

### Preserve the real test seam

Use local D1 tests for claims, fencing, completion failure, and cleanup. Use complete Discord Worker tests to prove all four callers use the shared policy. Retain existing queue, statistics, staff authorization, and background telemetry tests. Rerun the local benchmark at all existing scales; do not raise maximum budgets.

## Risks / Trade-offs

- A completion failure delays replay until lease expiry. This is the approved policy, not guaranteed exactly-once execution after expiry.
- An action can have its own post-commit work. This change only separates receipt completion failure from action execution; it does not infer database commit state from an arbitrary exception.
- Staff domain rejection differs from infrastructure failure. Keep the conversion explicit in staff handling and test both cases.
- Moving cleanup can lose telemetry attribution. Use the existing tracked background helper and test the measured environment.

## Migration Plan

No migration. Verify locally before any separately authorized deployment.

## Open Questions

None. The user confirmed both refactors and the receipt completion failure policy.
