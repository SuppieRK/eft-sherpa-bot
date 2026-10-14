# Implementation verification

Change: `simplify-raid-ordering`. Issue: [#43](https://github.com/SuppieRK/eft-sherpa-bot/issues/43).

## Verification

- Full repository verification passed under Node 26.11.1 and npm 12.0.2: formatting, Biome, Oxlint, TypeScript, Knip, migration checks, public documentation, workflow checks, deployment helper tests, 450 tests across 38 files, Worker dry-run build, and secret scan.
- Strict OpenSpec validation passed.
- Complete local Worker benchmark passed at 100, 1,000, 10,000, and 100,000 requests. It generated 198 exact cost entries with mocked Discord and Twitch APIs and local D1.
- Reviewed maximum budgets are unchanged. The exact baseline records intentional implementation and seed changes.
- Normal benchmark confirmation passed: all 198 exact cost entries match the recorded baseline at all four scales.

## Data preservation

Migration `0012` merges open raids in previous priority-first FIFO order and assigns unique sparse normal keys. Effective service order puts active raids first. Real D1 coverage includes all three game modes, overlapping old keys, active and reviewed raids, reserved leaders, follow-up relationships, waiting requests, complete request fields and notes, identity mappings, call state, timestamps, leader statistics, and terminal history.

Published migrations and their checksums are unchanged. The checksum checker normalizes Windows line endings. The new checksum is recorded only for unpublished migration `0012`. Legacy queue and attempt columns remain inert for historical compatibility. No migration or refresh calls or restarts a raid.

Use a forward fix after migration. A previous split-queue Worker can read retained columns but cannot preserve manual placement and shared pages. No streamer production deployment or data migration was performed. The developer pilot deployment is recorded below.

## Developer pilot deployment

On 2026-10-14 (Europe/Madrid), the verified local working tree was deployed to the existing developer-owned Cloudflare pilot at the user's request. Discord and Twitch callbacks already matched this pilot and were not redirected. Existing secrets were retained, and the retired attempt-limit variable was removed.

A D1 Time Travel bookmark and private before/after snapshots were saved before migration. Only migration `0012` was pending. The Worker version was uploaded first, then the migration was applied and the uploaded version received all pilot traffic.

The remote preservation comparison passed for all twenty requests, twenty-nine raids, thirty-six membership records, three identity mappings, receipt records, leaders, call state, timestamps, history, and statistics. Three open raids were merged, including one priority raid. Foreign-key checks passed. This pilot had no active raid during deployment; active-raid preservation remains covered by the real local D1 migration tests.

Live health and configuration checks passed. Twitch authorization is healthy, no legacy unassigned request remains, Discord resource validation passed, and the existing enabled Twitch subscription was reused. No requester calls or synthetic requests were sent during deployment verification.

Private deployment evidence, recovery information, snapshots, and the uploaded Worker bundle digest are under the ignored `.artifacts/dev-deployment/` directory. This is a development deployment from uncommitted verified source, not an exact-commit production release. Human platform acceptance is pending. The [operator guide](../../../docs/BOT_OPERATION.md) describes the controls.

## Behavior coverage

Tests cover streamer-only navigation and ordering, canonical message validation, latest-pin order, reversal, active-first ordering, continued automatic filling until Review, viewer positions, ten-row pages, both navigation directions, active/pinned/normal boundaries, refresh and intake resets, stale controls, exact duplicates, competing pins, pin/start overlap, navigation/intake overlap, retired attempt controls, complete payload limits, transactional rollback, and late-result fencing.

Recovery tests also inject a failure into final automatic-fill activation and verify that requests, groups, memberships, and dirty state roll back together. Existing concurrent recovery and capacity tests remain enabled.

## SQL evidence

At 100,000 requests, before and after exact counters are:

| Operation | Binding calls | Statements | Rows read | Rows written |
|---|---:|---:|---:|---:|
| discord.board.refresh | 7 → 7 | 8 → 8 | 230 → 217 | 3 → 3 |
| discord.board.open | 4 → 4 | 5 → 5 | 213 → 199 | 0 → 0 |
| discord.queue.p50 | 6 → 3 | 8 → 5 | 175 → 164 | 0 → 0 |
| discord.raid.result.helped | 14 → 10 | 19 → 15 | 321 → 280 | 29 → 32 |
| discord.requester.pull.with-push | 19 → 19 | 27 → 26 | 379 → 364 | 43 → 47 |

Forward pages explicitly seek within the cursor lane and the adjacent lane, cap each range at eleven candidates, and merge at most twenty-two IDs. Unused direction branches have a zero limit. Real D1 tests measure complete first and deep ten-row pages and check the actual query plans. Global and mode prefix reads remain indexed and capped.

First, middle, last, and reverse navigation each use five binding calls and six statements in the complete Worker benchmark. Read counts differ with page occupancy; reverse navigation also measures a full page near the end of the largest backlog. Moving and reversal use eight calls and ten statements. No-op and stale ordering use four calls and five statements and perform no raid or membership write.

The normal mode/map index prevents a pull from sorting or scanning a complete mode. Additional service indexes increase writes for Helped and pull operations as shown above; those costs remain inside their existing reviewed ceilings.

The recovery fixture now contains eighty unassigned requests across all thirty-nine mode/map buckets, plus one lookahead request. It resets invalid waiting states left by an earlier statistics fixture. Its writes are not directly comparable with the previous seventy-eight-category fixture. One extra bulk activation statement avoids repeated automatic-fill index maintenance without adding a binding call. Three worst-case repair passes remain below fifty statements. The separate ten-thousand-request recovery test retains its original one-thousand-write ceiling.

Generated evidence: [benchmark report](../../../reports/d1-user-facing-benchmark.md), [raw measurements](../../../reports/d1-user-facing-benchmark.json), [exact baseline](../../../benchmark/d1-cost-baseline.json), and [maximum budgets](../../../benchmark/d1-maximum-budget.json). Local timing remains informational.

Final benchmark input digest: `a21d85297e7b86ef5ccff95fb8e48ce8c893cf6c5965c637c6404024b77c9004`.

## Pilot pin terminology

The accepted terminology correction uses **Pinned**, **Pin to top**, and **Unpin** in the board, private confirmations, specifications, research decisions, and manual instructions. Existing action IDs and manual-order storage remain compatible. Ordering, automatic filling, page resets, and pin clearing on start or whole-raid postponement are unchanged. No migration or SQL change is required.

Full repository verification passed again with all 450 tests across 38 files. Existing rendering coverage now checks the Pinned badge, current controls, absence of retired wording, and maximum Discord payload sizes. Complete Worker coverage checks pin/unpin confirmations and the rendered canonical board while retaining duplicate, stale, and reversal checks. Strict OpenSpec validation passed.

The SQL benchmark evidence above measures the implementation before this terminology-only correction. Queries, statements, indexes, persistence, and reviewed budgets are unchanged; the benchmark was not rerun for this display correction.

The developer pilot was updated with the corrected terminology on 2026-10-14. The new Worker receives all pilot traffic, health/configuration and Twitch authorization checks passed, and no migration was applied. Private evidence and the uploaded bundle digest are in `.artifacts/dev-deployment/pin-evidence.json`. Select Refresh in Discord to render the corrected controls. Human acceptance remains pending.

## Coverage assessment

The 2026-10-14 coverage audit inspected assertions and fixtures for migration, pinning and reversal, viewer positions, automatic filling and Review, shared-page resets, whole-raid postponement, authorization, duplicate deliveries, selected concurrent interleavings, transaction rollback, failed platform delivery, and Discord output limits. Persistence tests use actual local D1 transactions, including injected database failures. Complete Worker tests authenticate signed Discord and Twitch payloads and wait for tracked background work. Platform REST responses are mocked.

The audit added a complete Worker regression for a linked viewer with outstanding requests in two modes. Signed streamer interactions pin the viewer's second-mode raid, pin another viewer's raid before it, and then unpin both. At all five stages, `/queue` and `!queue` must return the same expected next request, mode-scoped ordinal, global raids-ahead count, and other active mode/map. This closes the gap between separately tested placement logic and platform queue handlers.

The focused new regression and all ninety Discord workflow tests passed. Type checking, linting, and diff checks also passed. The previous full repository run passed 450 tests; the audit regression adds one test and changes no production code or SQL. The test addition alone did not require a deployment. The subsequent selector correction is recorded below.

The coverage is sufficient for automated verification of the changed business rules. It does not prove every possible interleaving or live platform behavior. Human checks should confirm actual Twitch replies, Discord display and channel access, and one test-account raid lifecycle with real call delivery. The [operator guide](../../../docs/BOT_OPERATION.md) describes the controls.

## Pin selector eligibility correction

Pilot feedback identified that pinned raids were still offered by Pin to top. The renderer now filters the already loaded planned page: Pin to top offers only unpinned raids, Unpin offers only pinned raids, and Review retains both. An empty ordering selector is omitted. This changes no SQL, schema, transaction, or stored ordering.

A new mixed-page regression failed against the previous renderer because its pin choices included the pinned raid. After the fix, rendering tests cover mixed pages, active-raid exclusion, and a fully pinned page with no pin dropdown. Complete Worker coverage also checks that the canonical pin dropdown excludes the newly pinned raid.

Full repository verification passed with 452 tests across 38 files, including the cross-platform queue regression from the coverage audit. Strict OpenSpec validation passed. This finding was a missing UI eligibility check, now explicitly described in the canonical and delta specifications and operator guide.

The corrected renderer was deployed to the existing developer pilot on 2026-10-14. The new version receives all pilot traffic, and health/configuration and Twitch authorization checks passed. No migration was applied. Private deployment evidence is in `.artifacts/dev-deployment/pin-selector-evidence.json`. Select Refresh on the existing board to render the corrected options.

## Reviewed requester movement correction

The reported sole-requester Lab case was reproduced through the complete Worker with eleven mode/map raids and then with one raid. Pagination was not the cause. The old renderer offered movement for every nonempty reviewed raid, and the old action created a follow-up when none existed. A sole-requester source closed and its replacement used the same queue position. Read-only pilot evidence confirmed that transition. Private identities and request fields remain in ignored evidence.

The accepted correction moves a reviewed requester only to the first existing eligible later raid in effective service order. The destination must have the same mode and map, remain planned and automatically fillable, have no review message, and have room. The lookup searches the indexed backlog beyond the displayed page. No destination means no move dropdown. Active requester postponement retains its source-linked follow-up behavior.

Planned move controls use a distinct action and carry the observed destination ID. Source state, current review message, membership, capacity, and the first eligible destination are revalidated before the atomic move. An old planned move cannot become an active postponement after another leader starts the raid, or silently choose a different destination. Empty sources close without creating a raid. Reserved destination leaders, request state, calls, and remaining source members are retained.

The regression coverage includes the original eleven-raid input, the minimized one-raid case, an existing destination beyond page one, pinned service order, ineligible full/reviewed/active/earlier/incompatible destinations, a stale destination token, duplicate signed interactions, a complete Worker authorization race, three transaction races, and injected destination-storage rollback. The migration test compares populated request, raid, membership, identity, receipt, and statistics tables exactly. A real D1 query-plan test seeks through 10,001 frozen synthetic raid records and reads fewer than thirty rows for source hydration.

Migration `0013` adds the partial destination index and resets the dirty board to page one. All previously recorded migrations and checksums remain unchanged. The previous Worker can read this schema, but reverting it restores automatic follow-up creation during review and old controls. Use a forward repair to preserve the accepted behavior.

The first hydration design materialized selected raids and exceeded the existing hundred-request board-burst ceiling: 708 reads against 700. It was replaced before acceptance. The final design computes availability on only the first current member row of each selected reviewed raid, reuses the result during bulk hydration, and skips ordinary and active raid lookups. It adds no separate destination binding call to hydration.

The complete local Worker benchmark passes at 100, 1,000, 10,000, and 100,000 requests. All 210 exact cost entries match on a normal confirmation run. The reviewed maximum-budget file is byte-for-byte unchanged from before this correction. At 100,000 requests:

| Operation | Binding calls | Statements | Rows read | Rows written |
|---|---:|---:|---:|---:|
| Reviewed move to an existing destination | 19 | 24 | 291 | 26 |
| Reviewed move with no destination | 7 | 7 | 32 | 3 |
| Stale reviewed destination | 7 | 7 | 34 | 3 |
| Board Refresh | 7 → 7 | 8 → 8 | 217 → 217 | 3 → 3 |
| Raid Review | 11 → 11 | 14 → 14 | 226 → 234 | 10 → 10 |
| Active requester postponement, source remains | 22 → 22 | 29 → 29 | 274 → 274 | 38 → 40 |

The move counters include receipt handling, detail rendering, and the background board drain. Rejected actions write only receipt state. Index maintenance intentionally adds two writes to new-request and active-postponement cases and up to four writes to pull cases. Pull-with-push reads increase from 364 to 378 and writes from 47 to 51. The hundred-request board burst stays at 698 reads against its unchanged 700 ceiling. The seeded database grows by one 4,096-byte page at each measured scale. These exact baseline changes were reviewed separately from the unchanged maximum budgets. Local timing is informational.

Final benchmark input digest for this correction: `272ca11c0ff901dfea90d8a8fdb43da2cd6fe1ad5c933ba48e4834a1fe025302`.

Full repository verification passed with 472 tests across 40 files under Node 26.11.1 and npm 12.0.2. Formatting, Biome, Oxlint, TypeScript, Knip, all thirteen immutable migration checks, public documentation, workflows, deployment-helper tests, Worker dry-run build, and secret checks passed. Strict OpenSpec validation passed. All seventeen implementation tasks are complete.

The existing developer pilot was updated on 2026-10-14. A fresh private snapshot and D1 Time Travel bookmark were saved, and the new Worker was staged before migration. Migration 0013 was applied. Exact comparisons retained all twenty-eight requests, thirty-eight raids, forty-five memberships, three identity mappings, seventeen receipts, and statistics records. Only the migration record, index, dirty version, and page cursor changed. Foreign-key checks passed.

During the switch, an imported deployment helper also executed its old command handler and briefly activated an older staged Worker. The intended new version was then activated and verified at one hundred percent traffic. The helper command was renamed to avoid that import side effect in future runs. The before/after data comparison passed, and the current Worker health, configuration, and Twitch authorization are healthy. The authoritative evidence for this update is `.artifacts/dev-deployment/reviewed-move-evidence.json`.

This is a developer deployment from verified uncommitted source. No production release was performed. Human acceptance remains pending. Select Refresh on the board and select Review for the source again to replace its existing detail controls. The [operator guide](../../../docs/BOT_OPERATION.md) describes reviewed movement. The separate pilot test document was removed at the user's request before PR preparation.

## PR preparation

The initial PR snapshot passed complete verification in a clean checkout with coverage enabled: 472 tests across 40 files, 92.72 percent line coverage, and 82.61 percent branch coverage. The normal local benchmark matched all 210 exact cost entries at all four scales. Its clean-checkout input digest is `131f086c4deff0199fffccf21ec44a5e110c2e061d832673de199f62afa5edc4`. Local skill setup and unrelated tooling edits were excluded from the PR.

The first GitHub verification and CodeQL runs passed. Sonar's quality gate passed with 92.2 percent new-code coverage and zero duplicated new lines, but its analysis reported two function-complexity findings and one nested ternary. Staff board ordering now has one private operation owner within the existing handler. Requester preparation returns an explicit nullable follow-up window, so planned movement needs one branch and active postponement needs no redundant missing-window guard. Confirmations use separate conditions. This refactor changes no SQL, transaction, authorization, or delivery contract. All 244 affected integration tests, type checks, formatting, and lint passed before the update was pushed.
