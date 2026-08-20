## 1. Statistics Domain and D1 Queries

- [x] 1.1 Add domain types and a query service for all-time request totals, successful raid totals, credited-leader totals, ranked leader rows, and omitted-leader count.
- [x] 1.2 Add a read-only D1 repository query with a constant bounded statement count that reads summary and per-leader rollups derived from help-request states and completed memberships in Helped raids.
- [x] 1.3 Add repository tests for empty data; every request and raid state; multi-requester success; removed historical memberships; postponed-then-completed requests; streamer and volunteer leaders; ranking ties; more than ten leaders; existing historical data; source-equivalent rollup transitions; and zero D1 writes.

## 2. Discord Command and Embed

- [x] 2.1 Add `/stats` and `/users` to the Discord staff command configuration and interaction router without adding either name to the Twitch parser or shared public command words.
- [x] 2.2 Reuse streamer and volunteer-role authorization for both commands and every user-page interaction, return an ephemeral denial to other callers, and ensure no unauthorized response reveals a count, leader, or identity record.
- [x] 2.3 Render one caller-only embed with list-based all-time totals, up to ten ranked leader mentions, successful raids in parentheses, an omitted-leader count, empty allowed mentions, and no components or stored message identity.
- [x] 2.4 Add Discord unit and workflow tests for streamer and volunteer access, unauthorized denial, caller-only flags, empty and populated lists, deterministic order, worst-case Discord limits, no notification pings, repeated independent snapshots, and absence of Delete, Refresh, persistence, and Twitch handling.

## 3. Staff User Directory

- [x] 3.1 Add a read-only user-directory repository query over normalized Twitch-login primary-key order with ten-row forward and reverse keyset pages, one lookahead row, no `OFFSET`, and no D1 writes.
- [x] 3.2 Render Twitch observation state, optional Discord association, and Escape from Tarkov name state without printing numeric platform IDs or sending mention notifications.
- [x] 3.3 Add versioned stateless Previous, Next, `Complete user details`, and `Back to users` controls that encode bounded login cursors, reauthorize every interaction, edit only the caller's ephemeral response, and return safe restart guidance for malformed boundaries.
- [x] 3.4 Add the native Discord-user selector and `Add EFT name` modal, enforce resolved member and 1–64 character name validation, claim mutations idempotently, conditionally fill only absent fields, preserve uniqueness, and rerender current state without notifications.
- [x] 3.5 Add inline-code `/link-twitch` correction guidance and automatic Twitch observation guidance without adding arbitrary overwrites, manual Twitch-ID input, search, or filters.
- [x] 3.6 Add repository, unit, and Discord workflow tests for empty, one-page, and multi-page directories; complete and missing details; first, middle, and last pages; forward and reverse order; successful Discord and EFT completion; duplicate Discord conflicts; concurrent and stale completion; concurrent mapping changes; malformed boundaries; worst-case component and embed limits; repeated independent sessions; and zero page persistence.

## 4. Performance, Documentation, and Release

- [x] 4.1 Add `/stats` to the stable fully local benchmark at 100, 1,000, 10,000, and 100,000 retained requests with deterministic mixed states, historical memberships, more than ten leaders, and ranking ties.
- [x] 4.2 Add `/users` first, middle, and last keyset pages plus one missing-Discord completion to every benchmark scale with deterministic mixed identity completeness and no remote API or D1 access.
- [x] 4.3 Generate and review latency, D1 duration, statement, row-read, and row-write evidence; require constant statements, zero page-read writes, bounded completion writes, and scale-independent directory page reads, then update the design and add aggregate storage only when measured statistics cost requires it.
- [x] 4.4 Update ASD-STE100 operator documentation and command-registration checks for staff-only `/stats` and `/users`, caller-only visibility, list definitions, pagination, `/link-twitch` corrections, and the absence of Twitch equivalents or persistent messages.
- [x] 4.5 Create a scenario-to-test traceability matrix and close every uncovered specification scenario, pagination boundary, or Discord-limit boundary.
- [x] 4.6 Run formatting, linting, type checking, dead-code and static analysis, migration and checksum checks, documentation and workflow checks, tests, build, secret scan, strict OpenSpec validation, and diff validation.
- [ ] 4.7 Create a new feature branch from the current accepted main revision, commit and push all change-scoped files, create a GitHub pull request with benchmark evidence, manually deploy the exact commit to DEV, register commands, and smoke-test both staff roles, unauthorized denial, caller-only visibility, statistics lists, user pagination, missing-detail completion, identity guidance, no message persistence, and no Twitch handling.

## 5. Staff Channel and Statistics Rollup Corrections

- [x] 5.1 Restrict `/stats`, `/users`, and every user-directory interaction to the configured Discord staff channel and add denial tests and operator guidance.
- [x] 5.2 Add migration `0004` with backfilled transactionally maintained statistics rollups, bounded repository reads, source-equivalence and schema tests, and immutable migration evidence.
- [ ] 5.3 Regenerate the fully local D1 benchmark, verify scale-independent `/stats` reads and bounded trigger writes, run the complete verification suite, update the pull request, deploy the exact commit to DEV, and smoke-test the correction.
