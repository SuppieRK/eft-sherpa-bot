# Verification

## Result

Both refactors are complete. One Discord mutation module owns claims, completion, failure release, and tracked cleanup. All four caller paths retain a pending claim if completion storage fails after the action succeeds. Queue and statistics handlers now call the existing repository methods directly.

No SQL, migration, dependency, public command, or hosting resource changed. No deployment was performed.

## Regression coverage

- Before the refactor, the new completion-failure tests failed for Twitch linking, missing-Discord edits, and raid review. EFT-name completion already retained its claim.
- All four Worker paths now pass completion-failure, immediate replay, action-failure retry, completed-duplicate, and background-cleanup failure checks.
- A staff domain rejection completes its receipt and does not apply the rejected transition.
- A local D1 trigger forces a real receipt completion failure. The test confirms pending protection, wall-clock lease use, recovery after expiry, and protection from an old token.
- A telemetry test confirms separate foreground and background D1 accounting through the shared module.
- Existing identity, raid details, queue, statistics, and access-control tests remain in place.

Tests: `test/integration/discord-workflow.test.ts` and `test/integration/discord-mutation-lifecycle.test.ts`.

## Checks

- `npm run verify`: passed; 387 tests in 34 files passed, including 15 new tests. Formatting, Biome, typed Oxlint, TypeScript, Knip, migration checks, documentation checks, workflow checks, deployment helper tests, dry-run build, and secret scan passed.
- `openspec validate consolidate-discord-mutation-lifecycle --strict`: passed.
- Validation ran from a separate local worktree containing the changed files. This avoided unrelated local skill files and existing line-ending-only worktree changes. Those files were not changed.
- Biome reported the existing informational schema-version difference: configuration 2.5.8 and CLI 2.5.12.

## Local D1 cost evidence

`npm run benchmark:d1` passed for all 161 operation/scale results at 100, 1,000, 10,000, and 100,000 requests. It used local Miniflare/workerd and mocked platform requests. It did not access remote D1.

All exact binding-call, statement, row-read, row-write, focused statement-group, and database-size baselines are unchanged. The exact baseline and maximum-budget files were not changed. No general speed or billing reduction is claimed. Wall-clock measurements are informational; tests and benchmarks ran concurrently on this machine.

- Reports: `reports/d1-user-facing-benchmark.json` and `.md`.
- Generated: `2026-09-10T04:39:08.493Z`.
- Runtime: Node `v26.7.0`.
- Source digest: `cad6c18f6c29a31c3fd9f411220d78c9839bce7be42c8eb39df2f877eb43bd81`.

The existing benchmark measures normal and adversarial operations. The new completion-failure behavior is covered by regression tests, not a new benchmark cost baseline.

## Delivery state

Prepared for pull-request review on `refactor/discord-receipts-and-query-cleanup`. No deployment or archival is part of this change.
