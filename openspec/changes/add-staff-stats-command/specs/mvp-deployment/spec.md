## MODIFIED Requirements

### Requirement: Pilot command registration
The private guild SHALL register the shared commands `/request` and `/queue`, the Discord-only association command `/link-twitch`, and the Discord-only staff controls `/board`, `/stats`, and `/users`. It SHALL NOT register `/position` or `/spike` as normal user commands.

#### Scenario: Guild commands are listed
- **WHEN** command registration completes
- **THEN** the guild contains the two shared commands, the association command, all three staff controls, and neither position nor spike

## ADDED Requirements

### Requirement: Staff statistics performance evidence gates release
Before release, the fully local D1 benchmark SHALL measure `/stats` at every existing tenfold scale from 100 through 100,000 active and historical requests. The deterministic seed SHALL include open, helped, and canceled requests; successful and not-run raids; completed and removed memberships; the streamer; more than ten volunteer leaders; and ranking ties. The generated report SHALL include latency, D1 rows read, D1 rows written, and statement counts. Statements SHALL remain constant, writes SHALL remain zero, and rows read SHALL grow no worse than linearly with retained history. Any unexplained superlinear read or latency growth SHALL block release until reviewed and resolved. The benchmark SHALL NOT contact remote D1 or platform APIs.

#### Scenario: Staff statistics benchmark is generated
- **WHEN** performance evidence is prepared for release
- **THEN** every scale measures the complete `/stats` repository and rendering path against seeded local D1 and deterministic Discord input

#### Scenario: Statistics query has unstable cost
- **WHEN** statement count changes by scale, a D1 row is written, or rows read or latency grow superlinearly
- **THEN** release remains blocked until the query, schema, fixture, or implementation is corrected and the report is regenerated

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
