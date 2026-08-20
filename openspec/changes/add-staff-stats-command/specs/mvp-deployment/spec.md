## MODIFIED Requirements

### Requirement: Pilot command registration
The private guild SHALL register the shared commands `/request` and `/queue`, the Discord-only association command `/link-twitch`, and the Discord-only staff controls `/board`, `/stats`, and `/users`. It SHALL NOT register `/position` or `/spike` as normal user commands.

#### Scenario: Guild commands are listed
- **WHEN** command registration completes
- **THEN** the guild contains the two shared commands, the association command, all three staff controls, and neither position nor spike

## ADDED Requirements

### Requirement: Staff statistics performance evidence gates release
Before release, the fully local D1 benchmark SHALL measure `/stats` at every existing tenfold scale from 100 through 100,000 active and historical requests. The deterministic seed SHALL include open, helped, and canceled requests; successful and not-run raids; completed and removed memberships; the streamer; more than ten volunteer leaders; and ranking ties. The generated report SHALL include latency, D1 rows read, D1 rows written, and statement counts. Statements and median rows read SHALL remain constant across scales, and `/stats` SHALL write zero rows. The same benchmark SHALL measure representative request and raid-result mutations. Their statements and writes SHALL remain constant, and their median indexed reads SHALL grow by no more than 32 rows across all benchmark scales. Any unexplained growth SHALL block release until reviewed and resolved. The benchmark SHALL NOT contact remote D1 or platform APIs.

#### Scenario: Staff statistics benchmark is generated
- **WHEN** performance evidence is prepared for release
- **THEN** every scale measures the complete `/stats` repository and rendering path against seeded local D1 and deterministic Discord input

#### Scenario: Statistics query has unstable cost
- **WHEN** statement count or median rows read changes by scale, a D1 row is written, or latency growth is unexplained
- **THEN** release remains blocked until the query, rollup, schema, fixture, or implementation is corrected and the report is regenerated

#### Scenario: Rollup maintenance cost grows with history
- **WHEN** a representative request or raid-result mutation changes its statement or write count or gains more than 32 median row reads across the benchmark scales
- **THEN** release remains blocked until the trigger, index, fixture, or mutation is corrected and the report is regenerated

### Requirement: Statistics rollup migration is additive and forward repaired
Migration `0004` SHALL create and backfill the singleton statistics summary and per-leader statistics rows before it installs transactional maintenance triggers. The migration SHALL preserve all authoritative request, membership, and raid history. After the migration is applied, a rollup defect SHALL be corrected with a forward migration rather than by rolling back to a Worker that reads absent rollup tables.

#### Scenario: Existing history is migrated
- **WHEN** migration `0004` is applied to a database with retained help history
- **THEN** the initial rollup result equals a direct aggregation of that history

#### Scenario: A deployed rollup needs correction
- **WHEN** a defect is found after migration `0004` was applied
- **THEN** deployment preserves authoritative history and uses a forward repair migration

### Requirement: Staff user-directory performance evidence gates release
Before release, the fully local D1 benchmark SHALL measure the first, middle, and last `/users` keyset pages and one missing-Discord completion at every existing tenfold scale from 100 through 100,000 user mappings. The deterministic seed SHALL mix observed and unobserved Twitch IDs, linked and unlinked Discord users, and present and missing Escape from Tarkov names. The generated report SHALL include latency, D1 rows read, D1 rows written, and statement counts. Page statements and row reads SHALL remain constant across scales and page reads SHALL write zero rows. Completion statements and writes SHALL remain bounded and constant across scales. The benchmark SHALL NOT contact remote D1 or platform APIs.

#### Scenario: User-directory benchmark is generated
- **WHEN** performance evidence is prepared for release
- **THEN** every scale measures first, middle, and last keyset navigation and one missing-Discord completion using only seeded local D1 and deterministic Discord interactions

#### Scenario: User pagination scans preceding pages
- **WHEN** a later-page query has row reads or latency that grow with the number of preceding users
- **THEN** release remains blocked until keyset ordering or index use is corrected and the report is regenerated

#### Scenario: Missing-detail completion cost grows with directory size
- **WHEN** the completion path's statements, writes, row reads, or latency grow with the number of unrelated mappings
- **THEN** release remains blocked until identity lookup, uniqueness enforcement, or mutation logic is corrected and the report is regenerated
