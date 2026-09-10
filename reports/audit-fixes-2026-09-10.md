# Audit fix verification

## Scope

The fixes protect concurrent raid actions, keep follow-up costs bounded, fit messages within platform limits, and protect existing Discord links. EFT profiles, hosting, and commands do not change.

Tests use public Worker commands, public repository methods, and local D1. Race tests pause at the D1 binding boundary. They do not mock repository methods. No remote D1 database or live platform API is used.

## Regression evidence

- A stale removal no longer cancels a request that moved to another raid.
- A stale sole-requester postponement no longer closes a raid after another requester joins.
- A stale Helped result no longer completes requests after whole-raid postponement wins.
- Twenty-five pull and postpone cycles preserve order. Gap repair does not change distant raid keys.
- Postponement after 1,000 and 10,000 closed follow-ups previously read 6,066 and 60,066 rows in the repository fixture. Both cases now read fewer than 200 rows.
- A Twitch queue reply with all 39 mode and map pairs previously had 845 characters. It now fits 500 characters and states how many additional entries were omitted.
- Four requesters with maximum-length Markdown details previously produced fields above 1,024 characters. Complete goals and notes now fit valid Discord fields and the total embed limit.
- Public linking and request submission can attach an unlinked member or update the same member. Only the streamer or a volunteer can replace a different Discord member.
- Two competing public attachments produce one successful attachment. The losing caller keeps the previous link.
- Migration 0011 removes retained closed-target links and uses the target index for later cleanup. Earlier migrations do not change.

## Measured D1 cost

These figures compare the committed baseline at `1fb3a23` with the audit fixes. The table uses 100,000 active requests. Counts include tracked background work.

| Operation | Statements before → after | Reads before → after | Writes before → after |
| --- | ---: | ---: | ---: |
| Discord request created | 15 → 16 | 262 → 263 | 28 → 28 |
| Discord self-link | 5 → 6 | 6 → 6 | 6 → 6 |
| Helped result | 18 → 19 | 319 → 321 | 29 → 29 |
| Postpone requester; source remains | 28 → 29 | 296 → 298 | 31 → 32 |
| Remove requester; source remains | 22 → 23 | 268 → 270 | 13 → 13 |
| Twitch request created | 24 → 24 | 273 → 273 | 34 → 34 |
| Twitch queue at p90 | 17 → 17 | 190 → 190 | 6 → 6 |

Binding calls do not change for these operations. The transaction guards add a small read cost but do not write guard records. The extra follow-up index adds one measured write when a relation is created and 4 KiB to each seeded database.

The new full Discord postponement case uses 1,000 active requests and 10,000 closed follow-ups. It reads 293 rows and writes 32 rows in 29 statements and 22 binding calls. This equals the normal postponement case at that scale. Historical closure happens during setup and is not included in the action count. The migration test and closure benchmark check cleanup separately.

The exact baseline includes the new case and the intentional guard costs. No maximum budget was increased. Wall-clock results are informational; local runner timing is not a production latency guarantee.

## Reproduce

Final verification passed: 437 tests in 37 files, format checks, lint, type checking, dead-code checks, migration checks, documentation checks, workflow checks, deployment-helper tests, dry-run build, and secret scan. The check-only local benchmark run matched all 162 exact baseline entries. OpenSpec validation passed. The existing Biome schema-version advisory remains unchanged.

Use Node 26 and the pinned dependencies. Run `npm run verify` and `npm run benchmark:d1`. The benchmark uses the all-zero local database ID and rejects remote bindings.

See [the full benchmark report](d1-user-facing-benchmark.md) and [the machine-readable results](d1-user-facing-benchmark.json) for all 162 operation and scale entries, runtime details, and the source digest. The report measures the uncommitted audit-fix worktree, not an already released version.
