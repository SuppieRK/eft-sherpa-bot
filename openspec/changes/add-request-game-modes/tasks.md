## 1. Baseline and Domain Model

- [x] 1.1 Checkpoint the completed `publish-github-delivery` archive and synced main specs separately, then confirm the game-mode implementation starts from a clean feature baseline.
- [x] 1.2 Add the canonical `pvp-seasonal`, `pvp`, and `pve` domain values, compact D1 code mappings, display labels, and longest-first Twitch aliases.
- [x] 1.3 Extend help-request, raid-group, repository, board, queue-fact, and call contracts so game mode is required and cannot be lost between layers.

## 2. Discord and Twitch Request Intake

- [x] 2.1 Add the three-choice `mode` option to Discord `/request` with `required: true`, verify Discord cannot submit the command without it, carry it in a versioned modal custom ID, reject invalid new-version state, and accept legacy version-one submissions as PvE.
- [x] 2.2 Parse Twitch `!request [mode] [map] [goal]` with longest-match handling for `pvp-seasonal`, `pvp seasonal`, and `seasonal`, while preserving map aliases, default goals, and text limits.
- [x] 2.3 Update request guidance, confirmations, and duplicate responses on both platforms to use the supported mode tokens and the `Mode · Map` display format.

## 3. Migration and Repository Invariants

- [x] 3.1 Add migration `0002` with non-null PvE-default mode fields on help requests and raid groups, replace active-request and compatible-raid indexes with mode-aware indexes, add the outstanding mode-order index, and record the finalized migration checksum without editing `0001`.
- [x] 3.2 Update request creation, projections, active-duplicate detection, and lookup queries so uniqueness is enforced by normalized Twitch login, game mode, and map.
- [x] 3.3 Update bulk materialization and compatible-raid selection to bucket and fill only by queue kind, game mode, and map while retaining bounded writes and map-specific requester capacity.
- [x] 3.4 Update individual-postponement follow-up reuse and creation to retain mode, and install D1 membership triggers that reject mismatched mode, map, or queue kind atomically.

## 4. Mode-Fair Board and Queue UX

- [x] 4.1 Implement one shared deterministic mode-presence merge that selects each non-empty mode's oldest raid first, sorts those heads by stable order, then fills remaining slots FIFO while preserving within-mode order.
- [x] 4.2 Read bounded per-mode Priority and Ordinary candidates through the new index, apply limits of three and seven after merging, retain accurate section totals, and reserve at least one visible raid for each non-empty mode.
- [x] 4.3 Make Queue select the caller's next request, calculate its ordinal among active requests in that mode, calculate raids ahead with the shared mode-presence order and existing caps, and label other requests by mode and map.
- [x] 4.4 Show `Mode · Map` in board rows, start options, persistent raid details, Discord calls, and Twitch calls without repeating mode in every participant row.

## 5. Regression and Performance Tests

- [x] 5.1 Add unit tests for all mode tokens and aliases, missing and invalid modes, Discord choice and modal-state parsing, legacy PvE submission, compact mappings, and display labels.
- [x] 5.2 Add local D1 migration tests that seed pre-mode rows, apply `0002`, verify PvE backfill and old-Worker defaults, enforce per-mode active uniqueness, and reject incompatible memberships.
- [x] 5.3 Add repository tests proving bulk materialization, compatible filling, and requester-postponement follow-ups never mix modes and continue to enforce parameterized sherpa capacity.
- [x] 5.4 Add board and Queue tests for single-mode, skewed two-mode, all-three-mode, Priority-before-Ordinary, stable FIFO, bounded-prefix, mode-scoped ordinal, raids-ahead, and all mode-bearing call and detail messages.
- [x] 5.5 Extend the fully local seeded benchmark with a deterministic mixed-mode distribution at every existing 10x size through 100,000 requests, run all user-facing operations, and produce an updated report with latency plus D1 rows read and written for every operation and size.

## 6. Documentation, Verification, and Delivery

- [x] 6.1 Update ASD-STE100 public and operator documentation for the Discord selector, Twitch syntax and aliases, mode-safe grouping, mode-fair board, mode-scoped Queue response, migration behavior, and focused smoke test.
- [x] 6.2 Regenerate or validate Discord command artifacts and run migration checksum, formatting, lint, type, static-analysis, and dead-code checks with zero findings.
- [x] 6.3 Run the complete automated test suite, strict OpenSpec validation, local mixed-mode benchmark, and diff checks; compare the new report with the previous report, prioritize D1 row-stat changes, and resolve or explain every material regression.
- [ ] 6.4 Confirm the accepted commit has complete benchmark evidence before release, deploy it through the protected maintainer workflow, smoke-test all three modes plus Discord and Twitch calls, then deploy the same verified patch to the streamer fork and repeat the focused smoke test.
