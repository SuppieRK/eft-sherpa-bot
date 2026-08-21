## 1. Atomic Request Intake

- [x] 1.1 Extend request creation with recipient capacity and combine identity, request, compatible raid, membership, legacy transition, assertion, and result lookup in one D1 batch.
- [x] 1.2 Return an explicit queue-effect signal and preserve created, duplicate-delivery, and already-active replies without duplicate raids or memberships.
- [x] 1.3 Remove normal waiting transitions and all command-time request materialization while retaining old-Worker-compatible state `0` support.

## 2. Worker, Board, and Deployment Flow

- [x] 2.1 Make Discord and Twitch request synchronization depend on the queue-effect signal; make both queue commands read directly.
- [x] 2.2 Reuse one board snapshot and payload across Refresh response, detail reconciliation, and canonical update.
- [x] 2.3 Remove materialization from board Refresh and retain current detail-message reconciliation behavior.
- [x] 2.4 Add authenticated bounded legacy repair, deployment draining, status reporting, and a zero-legacy release gate.
- [x] 2.5 Decouple receipt claims from cleanup and schedule leased 15-minute, 100-row maintenance after new mutation receipts.

## 3. Migration and Regression Coverage

- [x] 3.1 Keep migration `0005` compatible with migrations `0001` through `0004` and with the previous Worker's waiting insert, membership insert, and explicit state update.
- [x] 3.2 Cover atomic existing-raid reuse, new-raid creation, mode/map/queue isolation, active/reviewed exclusion, configured capacity, and parameterized Icebreaker capacity.
- [x] 3.3 Cover duplicate and already-active requests, targeted legacy repair, injected rollback, and the invariant that every returned active request has exactly one open membership.
- [x] 3.4 Cover concurrent compatible intake, exact capacity overflow, contiguous unique positions, and different-mode isolation.
- [x] 3.5 Cover zero command-time materialization, protected repair authentication, bounded/idempotent draining, and final board synchronization.
- [x] 3.6 Cover receipt lease timing, concurrency, oldest-first bounds, recent preservation, draining, and non-fatal failure.

## 4. Performance Evidence and Delivery

- [x] 4.1 Add opt-in statement-level D1 metrics and focused per-item reporting without production detail capture.
- [x] 4.2 Remove the waiting-backlog board benchmark and enforce atomic-intake plus zero-maintenance queue and Refresh contracts.
- [x] 4.3 Regenerate fully local D1 reports through 100,000 requests and run complete repository verification.
- [x] 4.4 Update PR #15 with the before-and-after evidence, commit the fixes on the current branch, and push without deploying.
