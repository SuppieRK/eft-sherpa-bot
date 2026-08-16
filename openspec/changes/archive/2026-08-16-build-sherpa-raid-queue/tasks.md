## 1. Proven Foundation

- [x] 1.1 Create the strict TypeScript Cloudflare Worker project and CI checks.
- [x] 1.2 Prove signed Twitch EventSub delivery, stable caller IDs, D1 access, duplicate suppression, and chat replies on developer-owned resources.
- [x] 1.3 Prove signed Discord interactions, stable caller IDs, D1 access, and ephemeral replies with a guild-only spike.
- [x] 1.4 Record the hardcoded Tarkov map catalog and sherpa-party capacities.
- [x] 1.5 Add one committed private-pilot community configuration and external secrets.

## 2. MVP Reset

- [x] 2.1 Rewrite the proposal and design around the private request-to-result pilot.
- [x] 2.2 Replace the disposable migration history with the seven-table baseline.
- [x] 2.3 Replace the split repositories with one small D1 MVP repository.
- [x] 2.4 Remove the spike command tables and remove `/spike` from Discord command registration.
- [x] 2.5 Remove persistent drafts, projections, outboxes, rollups, maintenance jobs, and backup jobs.
- [x] 2.6 Update the OpenSpec capability requirements to match the reduced scope.

## 3. Complete Command Workflow

- [x] 3.1 Register the shared viewer commands `/request`, `/queue`, and `/position`, plus the Discord-only staff control `/board`.
- [x] 3.2 Implement and test the `/request` modal and idempotent seven-table request creation.
- [x] 3.3 Implement and test privacy-safe `/queue`, `/position`, `!queue`, and `!position` responses.
- [x] 3.4 Implement and test the first `!request` entry point; direct Twitch intake in 3.7 supersedes its Discord-channel guidance.
- [x] 3.5 Replace request-scoped identity claims with a Twitch-first `user_mappings` table without increasing the seven-table schema.
- [x] 3.6 Require Twitch name on Discord `/request`; implement and test `/link-twitch` self-linking and staff Discord-user selection.
- [x] 3.7 Implement mobile-native `!request <map> [goal]`, map-alias parsing, typo guidance, and goal and in-game-name defaults.
- [x] 3.8 Enforce one active request per Twitch login and map with an explicit race-safe create outcome across both platforms.
- [x] 3.9 Replace public reference lookup with identity-first optional-map position and projected group estimates.
- [x] 3.10 Display Twitch identity and link state on the staff board while keeping internal references out of normal viewer replies.
- [x] 3.11 Store a reusable Escape from Tarkov name in the Twitch-first mapping and prefill it in Discord `/request`.
- [x] 3.12 Separate queue totals from caller position and replace unknowable raid-ahead wording with projected groups.
- [x] 3.13 Remove redundant queue and position subject labels from personal command replies.
- [x] 3.14 Add optional `/link-twitch` in-game names and restrict Discord-member selection to the streamer or volunteer-sherpa role.

## 4. Visual Raid Board

- [x] 4.1 Generate editable same-map raid groups directly from waiting requests in priority and arrival order.
- [x] 4.2 Enforce one streamer or eligible volunteer leader and the hardcoded map party capacity.
- [x] 4.3 Support raid reordering, compatible open-place assignment, and current-state board rendering.
- [x] 4.4 Support helped, whole-raid postponement, and requester postponement or removal.
- [x] 4.5 Preserve unresolved groups with higher priority through whole-raid postponement.
- [x] 4.6 Pause, resume, and end a night without asking for a destination date.

## 5. Schedule and Reliability

- [x] 5.1 Store one bounded Twitch schedule snapshot and refresh it through Cron and a staff control.
- [x] 5.2 Select the next local night automatically from a fresh stored snapshot.
- [x] 5.3 Verify Discord and Twitch signatures and deduplicate all mutating deliveries in `event_receipts`.
- [x] 5.4 Store Twitch reply text before delivery and allow a duplicate delivery to retry an unsent reply.
- [x] 5.5 Keep private telemetry.

## 6. Private Pilot

- [x] 6.1 Replace focused tests so they cover every supported command and board action against the seven-table schema.
- [x] 6.2 Update README and operator instructions for the real private-pilot workflow and destructive database reset.
- [x] 6.3 Run formatting, linting, type checking, tests, a migration check, secret scanning, and a dry Worker build.
- [x] 6.4 Recreate the disposable developer-owned D1 database and deploy the verified commit.
- [x] 6.5 Verify the Twitch-native flow, rewrite the disposable baseline, reset D1, deploy, and register the revised command surface.
- [x] 6.6 Run the complete private pilot with the user and streamer using the command surface registered in 6.5.
  - Incorporate accepted findings directly into the applicable proposal, design, specification, task, and README sections.
- [x] 6.7 Record the pilot result before any streamer-owned setup or public launch.
  - The user confirmed on 2026-08-16 that manual testing was complete and the workflow was accepted.

## 7. Refined Automatic Board

- [x] 7.1 Reconcile the proposal, design, requirements, and pilot scope with the refined `/board` decisions.
- [x] 7.2 Replace manual planning, membership editing, skip, and retry paths with automatic five-raid same-map materialization.
- [x] 7.3 Render the immediate embed board with nested requester details, physical occupancy, raid-level outcomes, and leader-only reassignment.
- [x] 7.4 Update the operator README and OpenSpec artifacts for the new workflow.
- [x] 7.5 Replace obsolete focused tests and run the complete local verification suite.
- [x] 7.6 Reset and redeploy the disposable private pilot with the revised baseline before retesting.

## 8. Always-Available Command Endpoints

- [x] 8.1 Remove the public-command toggle from runtime routing, deployment configuration, health output, tests, and operator documentation.
- [x] 8.2 Redeploy the private Worker and verify that its Discord, Twitch, health, and authenticated operator endpoints remain reachable.

## 9. Progressive Raid Operations

- [x] 9.1 Reconcile proposal, design, requirements, and pilot acceptance with the fixed-ten progressive-disclosure workflow.
- [x] 9.2 Replace the disposable baseline and repository behavior with unlimited materialization, text limits, attempt state, priority, message identity, call status, and schedule-segment reconciliation while retaining seven tables.
- [x] 9.3 Remove position from both platforms and make queue include global totals plus authenticated caller status.
- [x] 9.4 Replace the interaction board with one canonical fixed-ten message containing Refresh and one planned-raid selector.
- [x] 9.5 Implement one-step raid start, conditional Discord and Twitch calls, persistent detailed raid messages, authorization, and per-platform result state.
- [x] 9.6 Implement configurable attempt progression, terminal Helped or Postpone behavior, and individual next-raid postponement.
- [x] 9.7 Update focused tests, README, deployment workflow, runbook, and OpenSpec artifacts for the implemented workflow.
- [x] 9.8 Run the complete verification suite, reset and deploy the disposable private pilot, register the reduced command surface, verify all endpoints, and commit the checkpoint.

## 10. Schedule-Independent Dual Queues

- [x] 10.1 Reconcile proposal, design, requirements, and acceptance with schedule-independent ordinary and priority queues.
- [x] 10.2 Replace the disposable baseline with the six-table queue schema and required queue-kind and uniqueness indexes.
- [x] 10.3 Remove Twitch schedule API, cron, timezone, night state, rollover, and internal refresh behavior while keeping Twitch chat delivery and authorization checks.
- [x] 10.4 Materialize new requests into ordinary FIFO raids and move postponed raids through priority FIFO without time-based mutation.
- [x] 10.5 Render complete totals with independent `LIMIT 3` priority and `LIMIT 7` ordinary board windows plus one combined start selector.
- [x] 10.6 Update queue facts, postponement, canonical board persistence, tests, README, deployment workflow, and runbook for the six-table behavior.
- [x] 10.7 Run complete verification, preserve the canonical board ID, reset and deploy the disposable pilot, verify live endpoints and no cron, and commit the checkpoint.

## 11. Refined Raid Deep-Dive Controls

- [x] 11.1 Reconcile proposal, design, and requirements with the refined board counters and raid-detail actions.
- [x] 11.2 Implement permanent requester removal, whole-raid priority postponement, and obsolete raid-message deletion without changing the six-table schema.
- [x] 11.3 Retain the visible leader tag without repeat notifications and simplify the canonical board counter text.
- [x] 11.4 Update focused tests and operator documentation, then run complete repository and strict OpenSpec verification.
- [x] 11.5 Commit and redeploy the private pilot without a D1 reset or Discord command re-registration, then verify live endpoints.

## 12. Pilot Board Recovery and Personal Queue Wording

- [x] 12.1 Reconcile proposal, design, and requirements with stale active-detail recovery and caller-only queue replies.
- [x] 12.2 Implement bounded background Discord detail-message reconciliation with D1 compare-and-set and active-only links.
- [x] 12.3 Remove queue aggregate projection facts and retain the caller's priority-first global ordinal, raids ahead, map, and other maps.
- [x] 12.4 Add focused recovery, concurrency, no-ping, and queue-response tests; update operator documentation; run complete verification.
- [x] 12.5 Commit and deploy without a D1 reset or command re-registration, verify live endpoints, and record the deployed Worker version.

## 13. Terminal Raid-Message Cleanup

- [x] 13.1 Reconcile proposal, design, and requirements so `Helped` and `Postpone raid` delete obsolete detail messages.
- [x] 13.2 Clear terminal detail-message identities and delete the corresponding Discord messages without rolling back durable outcomes on deletion failure.
- [x] 13.3 Add focused success and deletion-failure regression tests and update operator instructions.
- [x] 13.4 Run complete verification, commit, and deploy without a D1 reset or command re-registration; verify live endpoints and record the Worker version.

## 14. Consolidated OpenSpec Maintenance

- [x] 14.1 Audit every current pilot decision against the proposal, design, capability specifications, tasks, and operator README.
- [x] 14.2 Make the standard OpenSpec artifacts the direct source of truth for accepted pilot findings and remove historical feedback-ledger references.
- [x] 14.3 Remove the parallel decisions and deployment-status feedback ledger.
- [x] 14.4 Run formatting and strict OpenSpec validation, confirm no feedback-file references remain, and commit the documentation change.

## 15. D1 Correctness, Scale, and Retention Review

- [x] 15.1 Replace generated request columns, text finite states, text timestamps, text retry keys, and dense raid positions with derived values, compact integers, and sparse ordering keys.
- [x] 15.2 Add general membership and compatible-raid indexes; replace all-row Queue projection with caller-first indexed aggregate queries.
- [x] 15.3 Materialize waiting requests in one fixed-size D1 batch and remove serial per-request assignment queries.
- [x] 15.4 Make requester postponement atomic and limit Helped completion to current source memberships.
- [x] 15.5 Add Discord replay-age validation, remove the constant receipt outcome, and expire receipts after 24 hours.
- [x] 15.6 Add schema, backlog, rollback, postponed-member, replay-window, and receipt-retention regression tests; update OpenSpec and operator documentation.
- [x] 15.7 Run complete verification, reset the disposable D1 database, deploy, verify live endpoints, and commit the remediation.

## 16. Postpone-Only Outcome and Measured Materialization

- [x] 16.1 Remove the Try Again UI option, handler, repository transition, outcome code, retry-origin state, tests, and current OpenSpec requirements.
- [x] 16.2 Make `Postpone raid` the sole unresolved final-attempt action while reusing the same raid, memberships, leader, and capacity.
- [x] 16.3 Allocate new raid keys after all open raids, skip group reads when no request waits, use queue-and-map target buckets, and remove duplicate Queue materialization and unreachable normalization.
- [x] 16.4 Remove obsolete grouping and night-planning modules plus unused request indexes.
- [x] 16.5 Add a reproducible fully local seeded-D1 benchmark and report, including the waiting-index improvement discovered from measured row counts.
- [x] 16.6 Run complete verification, reset the disposable D1 baseline, deploy, verify live endpoints, and commit the review remediation.

## 17. Stable Local User-Operation Benchmark

- [x] 17.1 Reconcile the proposal, design, requirements, and README with the full-Worker, local-only benchmark contract.
- [x] 17.2 Add a fail-closed zero-ID local D1 configuration, deterministic 100-to-100,000 seeder, mocked platform APIs, and operation coverage manifest.
- [x] 17.3 Measure three warmups and ten samples for the selected Discord, Twitch, board, raid, and requester paths with deterministic cost invariants.
- [x] 17.4 Generate raw JSON and Markdown reports, add focused harness tests, and remove the superseded narrow report.
- [x] 17.5 Run the complete local benchmark, repository verification, and strict OpenSpec validation without deployment or remote D1 access, then commit the benchmark evidence.

## 18. Indexed Fillable-Raid and Queue Reads

- [x] 18.1 Reconcile the proposal, design, requirements, tasks, and operator README with trigger-maintained raid occupancy, indexed range reads, the unchanged local benchmark contract, and direct disposable-baseline replacement.
- [x] 18.2 Add trigger-maintained current membership count and a capacity-bounded compatible-raid index to the first baseline migration, then update its checksum.
- [x] 18.3 Replace membership-count joins, cross-priority range predicates, correlated board positions, repeated total queries, and open-queue maximum scans with bounded indexed reads while preserving user-visible behavior.
- [x] 18.4 Add counter-synchronization, fillability, ordering, transition, and query-plan regressions; run the complete verification suite and strict OpenSpec validation.
- [x] 18.5 Run the unchanged fully local 100-to-100,000 benchmark and commit a before-and-after evidence report without accessing remote D1.
- [x] 18.6 Preserve the canonical board ID, recreate only the disposable pilot D1 database, deploy the verified commit, and verify live endpoints and pilot command behavior without re-registering commands.

## 19. Bounded Queue Facts and Map-Aware Capacity

- [x] 19.1 Reconcile the proposal, design, capability requirements, tasks, and operator README with capped exact Queue facts and map-aware requester-capacity enforcement.
- [x] 19.2 Add the complete committed map-capacity constraint to the disposable baseline and update its checksum.
- [x] 19.3 Replace unbounded Queue aggregates with indexed capped-prefix reads and shared exact-or-lower-bound rendering.
- [x] 19.4 Add parameterized map-capacity, overflow, Queue wording, cost, and query-plan regressions; run complete verification and strict OpenSpec validation.
- [x] 19.5 Run the unchanged fully local 100-to-100,000 benchmark and publish comparison evidence without accessing remote D1.
- [x] 19.6 Preserve the canonical board ID, recreate only the disposable pilot D1 database, deploy the verified commit, and verify live endpoints without re-registering Discord commands.

## 20. Static Quality Gates

- [x] 20.1 Reconcile the proposal, design, deployment requirements, tasks, and README with Biome formatting, TypeScript 7-aware Oxlint, zero-baseline Knip, and no literal Spotless layer.
- [x] 20.2 Add pinned Oxlint, TypeScript-Go, and Knip dependencies, configurations, developer commands, and blocking verification integration.
- [x] 20.3 Remove unreachable modules and unnecessary exports reported by Knip without suppressing source findings.
- [x] 20.4 Fix every configured Oxlint finding, including safe Discord header construction and typed request-body assertions, and add focused regression coverage.
- [x] 20.5 Run each quality gate, complete repository verification, and strict OpenSpec validation; commit the zero-finding checkpoint.
- [x] 20.6 Deploy the verified Worker without D1 reset or Discord command registration and verify live health, status, and webhook routing.

## 21. Discord Command Reference Formatting

- [x] 21.1 Render every Discord slash-command reference in bot replies inside backticks and audit the current reply paths.
- [x] 21.2 Add regression coverage, update the applicable OpenSpec artifacts and operator README, and run repository verification.
- [x] 21.3 Commit and deploy the verified wording correction without a D1 reset or Discord command registration, then verify live endpoints.

## 22. Archival Readiness

- [x] 22.1 Audit the current command surface, Worker routes, six-table D1 baseline, configuration, tests, and deployment workflow against the proposal, design, and capability specifications.
- [x] 22.2 Record the accepted manual pilot in the proposal, design, deployment requirement, tasks, and operator README without expanding scope to streamer-owned deployment or public launch.
- [x] 22.3 Run complete repository verification and strict OpenSpec validation, produce the completeness, correctness, and coherence assessment, and commit the archival-ready artifacts.
