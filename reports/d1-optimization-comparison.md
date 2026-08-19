# Local D1 Optimization Comparison

## Contract

This comparison uses the unchanged full-Worker benchmark contract, deterministic seed, operation list, D1 metrics wrapper, and fully local Miniflare/workerd D1 database. It did not use Cloudflare credentials, the pilot Wrangler configuration, or a remote D1 database.

- Baseline: `55d63b881ebc8ef3d0db3a5bb968a019540a8b20`
- Optimized implementation: `5b4b39d2e2840a450ab29edbe77e304ced722cf5`
- Scales: 100, 1,000, 10,000, and 100,000 active requests
- Sampling: 3 warmups and 10 measured samples per operation and scale
- Evidence: the baseline report stored at the baseline commit and the current [raw JSON report](d1-user-facing-benchmark.json)

Wall times are local observations. D1 statement, row-read, and row-write counts are the stable comparison signals.

## Acceptance Results

| Check | Required | Measured | Result |
|---|---:|---:|---|
| Created-request row-read growth from 100 to 100,000 | At most 2× | 201 to 205, or 1.02× | Pass |
| Discord Queue ordering at 100,000 | p10 < p50 < p90 | 13,429 < 67,114 < 120,799 | Pass |
| Discord Queue p10 and p50 versus baseline | Both improve | 134,219 to 13,429 and 67,114 | Pass |
| Discord Queue p90 versus baseline | No regression | 134,219 to 120,799 | Pass |
| Board operation reads at 100,000 | Below 40,000 | Maximum 485 | Pass |
| Row-read regressions across every operation and scale | None | 0 of 84 results regressed | Pass |
| Maximum statements per operation | Below 50 | 21 | Pass |
| Maximum rows written per operation | Below 50 | 35 | Pass |

## Selected 100,000-Request Results

| Operation | Baseline rows read | Optimized rows read | Baseline wall median ms | Optimized wall median ms |
|---|---:|---:|---:|---:|
| Discord request submission (created) | 237,145 | 205 | 63 | 51 |
| Discord Queue at p10 | 134,219 | 13,429 | 28 | 27 |
| Discord Queue at p50 | 134,219 | 67,114 | 29 | 29 |
| Discord Queue at p90 | 134,219 | 120,799 | 30 | 29 |
| Discord board create | 103,427 | 485 | 61 | 52 |
| Discord board open existing | 103,427 | 485 | 59 | 47 |
| Discord board Refresh | 103,412 | 470 | 57 | 46 |

The trigger-maintained occupancy index removes full raids from materialization reads. Trigger-maintained board totals remove repeated full-queue count scans. Split queue range counts make the row cost follow the caller's actual position instead of reading the same full range for all callers.

## Bounded Queue Follow-up

Commit `d5c55bb` replaces the remaining unbounded Queue range counts with capped ordered-prefix reads. The benchmark contract, deterministic seed, operation list, local D1 binding, warmups, and samples are unchanged. Queue stays exact through 100 requests ahead and 50 raids ahead; later callers receive an explicit lower bound.

| Active requests | Operation | Previous rows read | Bounded rows read |
|---:|---|---:|---:|
| 100 | Discord Queue p90 | 130 | 130 |
| 1,000 | Discord Queue p50 | 681 | 162 |
| 1,000 | Discord Queue p90 | 1,218 | 162 |
| 10,000 | Discord Queue p10 | 1,350 | 160 |
| 10,000 | Discord Queue p50 | 6,720 | 162 |
| 10,000 | Discord Queue p90 | 12,088 | 162 |
| 100,000 | Discord Queue p10 | 13,429 | 160 |
| 100,000 | Discord Queue p50 | 67,114 | 162 |
| 100,000 | Discord Queue p90 | 120,799 | 162 |
| 100,000 | Twitch Queue p10 | 13,436 | 167 |
| 100,000 | Twitch Queue p50 | 67,121 | 169 |
| 100,000 | Twitch Queue p90 | 120,806 | 169 |

The largest measured Discord Queue read is 162 rows, below the 200-row contract. The largest measured Twitch Queue read is 169 rows, below the 220-row contract. Both remain flat from 10,000 to 100,000 requests at every sampled percentile. At 100 requests, exact answers remain below both caps and retain the previous row cost.

## Seed Storage

| Active requests | Baseline bytes | Optimized bytes | Difference |
|---:|---:|---:|---:|
| 100 | 139,264 | 143,360 | +4,096 |
| 1,000 | 700,416 | 700,416 | 0 |
| 10,000 | 6,062,080 | 5,984,256 | -77,824 |
| 100,000 | 62,083,072 | 61,403,136 | -679,936 |

At the largest seed, the optimized schema uses about 664 KiB less local D1 storage despite the two board counters and per-raid occupancy counter.

## Game-Mode Release Comparison

The game-mode candidate uses a deterministic 70% PvE, 20% PvP, and 10% PvP Seasonal raid mix. The comparison baseline is the prior tracked report. The candidate report was generated on 2026-08-18 with the same four scales, operation list, warmups, samples, and fully local D1 guard.

| 100,000-request operation | Prior rows read | Mode-aware rows read | Prior rows written | Mode-aware rows written |
|---|---:|---:|---:|---:|
| Discord request submission (created) | 206 | 229 | 31 | 34 |
| Discord Queue p10 | 160 | 166 | 0 | 0 |
| Discord Queue p50 | 162 | 174 | 0 | 0 |
| Discord Queue p90 | 162 | 174 | 0 | 0 |
| Discord board open | 485 | 545 | 0 | 0 |
| Discord streamer-led raid start | 204 | 224 | 9 | 10 |
| Discord postpone requester (source remains) | 216 | 248 | 24 | 26 |

The added reads are bounded. Queue reads at 100,000 requests remain below the contracts: Discord uses at most 174 rows and Twitch uses at most 181 rows. The board reads up to 30 mode-specific candidates before it hydrates no more than ten visible raids. This adds 60 deterministic D1 row reads because local D1 counts the compound-query inputs and results.

The added writes come from the mode-aware request and raid indexes and from compatibility-triggered state changes. The maximum operation uses 38 writes, below the limit of 50. No write count changes with scale.

| Active requests | Prior database bytes | Mode-aware database bytes | Change |
|---:|---:|---:|---:|
| 100 | 147,456 | 155,648 | +5.56% |
| 1,000 | 704,512 | 745,472 | +5.81% |
| 10,000 | 5,988,352 | 6,234,112 | +4.10% |
| 100,000 | 61,407,232 | 64,266,240 | +4.66% |

The 100,000-request database adds about 2.73 MiB for two required mode columns and three mode-aware indexes. The increase is accepted because it enforces mode-safe uniqueness, grouping, and bounded fair board reads. Wall-time changes are local observations; D1 row and write counts remain the release decision signals.

## Pre-call Review Comparison

The review-first candidate replaces one immediate-start operation with two deliberate user operations. **Review a raid** freezes the proposed party and stores its detail-message identity. **Call and start raid** later assigns the caller as leader, starts attempt one, and sends the calls. The prior tracked report is the immediate-start baseline. Both reports use the same fully local D1 benchmark guard, scales, warmups, and samples.

| Active requests | Prior immediate-start rows read | Review rows read | Call/start rows read | Two-step total rows read | Prior rows written | Two-step rows written |
|---:|---:|---:|---:|---:|---:|---:|
| 100 | 211 | 184 | 210 | 394 | 10 | 13 |
| 1,000 | 220 | 193 | 219 | 412 | 10 | 13 |
| 10,000 | 220 | 193 | 219 | 412 | 10 | 13 |
| 100,000 | 224 | 197 | 223 | 420 | 10 | 13 |

The additional cost is the new staff confirmation step, not scale-dependent query growth. Review reads increase by 13 rows and call/start reads increase by 13 rows from 100 to 100,000 active requests. Call/start uses fewer reads and writes than the old immediate start at every scale. The complete two-step workflow adds three writes for the frozen review state and message identity. This cost is accepted because the review step prevents calls before staff confirm the grouped requests.
