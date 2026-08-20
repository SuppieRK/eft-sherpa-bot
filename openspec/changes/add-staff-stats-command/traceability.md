# Test Traceability

| Scenario | Test evidence |
|---|---|
| Empty and populated all-time totals | `staff-insights-repository.test.ts` |
| Completed-member leader credit and removed-member exclusion | `staff-insights-repository.test.ts` |
| Ranking ties, ten-row limit, and omitted leaders | `staff-insights-repository.test.ts`, `staff-insights.test.ts` |
| Streamer or volunteer access and unauthorized denial | `discord-workflow.test.ts` |
| Caller-only statistics with no controls or pings | `discord-workflow.test.ts`, `staff-insights.test.ts` |
| First, middle, last, forward, and reverse user pages | `staff-insights-repository.test.ts`, local D1 benchmark |
| Missing Discord and EFT completion | `staff-insights-repository.test.ts`, `discord-workflow.test.ts` |
| Stale updates and Discord uniqueness | `staff-insights-repository.test.ts` |
| Malformed component boundaries | `staff-insights.test.ts`, `discord-workflow.test.ts` |
| Discord embed, component, and custom-ID limits | `staff-insights.test.ts` |
| Zero-write reads and bounded D1 costs | `staff-insights-repository.test.ts`, local D1 benchmark report |
| No Twitch command handling | `command-surface.test.ts`, `benchmark-contract.test.ts` |
