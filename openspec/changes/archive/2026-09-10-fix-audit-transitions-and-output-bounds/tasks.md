## 1. Atomic raid transitions

- [x] 1.1 Reproduce stale removal through the D1 seam; prevent cancellation of a moved requester.
- [x] 1.2 Reproduce last-requester postponement racing with a pull; preserve valid source state.
- [x] 1.3 Reproduce Helped racing with whole-raid postponement; roll back stale completion.

## 2. Follow-up cost and ordering

- [x] 2.1 Reproduce ordering gap exhaustion; add collision-safe allocation.
- [x] 2.2 Measure closed-target history and bound follow-up reads with regression coverage.

## 3. Output and identity safety

- [x] 3.1 Reproduce oversized Twitch queue output; bound replies with an omitted count.
- [x] 3.2 Reproduce oversized Discord fields; retain complete details in valid fields.
- [x] 3.3 Test and enforce safe self-linking and staff replacement for linking and request submission.

## 4. Verification

- [x] 4.1 Validate OpenSpec, including the corrected configured requester capacity.
- [x] 4.2 Run full tests, static checks, and build in a clean local environment.
- [x] 4.3 Run local D1 benchmarks; report read/write changes and review exact baseline updates without silently raising maximum budgets.
