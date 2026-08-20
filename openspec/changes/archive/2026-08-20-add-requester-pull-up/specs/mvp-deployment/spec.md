## ADDED Requirements

### Requirement: Requester pull-up uses additive migration 0003
Migration `0003` SHALL add a partial raid-group index ordered by queue kind, game mode, map, and stable raid order for planned, automatically fillable, unreserved raids. It SHALL support full and partial pull-source discovery and bounded push-target lookup without changing a stored row or removing an existing index. The migration SHALL remain structurally compatible with the previous Worker, which ignores the additional index.

#### Scenario: Pull source can be full
- **WHEN** local schema verification explains the planned source query for a full same-mode and same-map raid
- **THEN** SQLite seeks through the migration `0003` index instead of scanning `raid_groups` or creating a temporary order sort

#### Scenario: Previous Worker is restored
- **WHEN** the new Worker fails validation after migration `0003` is applied
- **THEN** the operator may restore the previous verified Worker without reverting the unused index or changing live request data

### Requirement: Pull-up performance evidence gates release
Before release, the fully local D1 benchmark SHALL add the private pull-source selector, a maximum bounded pull with successful push-down, and planned-review cancellation to every existing tenfold scale through 100,000 active requests. The seed SHALL include deterministic same-mode and same-map sources, a Priority destination with an Ordinary source, a legal push target, and a frozen planned review with a canonical details message. The generated report SHALL include latency, D1 rows read, D1 rows written, and statement counts. D1 row statistics SHALL be the primary cost evidence. Statement and write counts SHALL remain constant across scales, and any material row-read or latency growth SHALL block release until reviewed and resolved. The benchmark SHALL NOT contact remote D1 or platform APIs.

#### Scenario: Pull-up benchmark is generated
- **WHEN** performance evidence is prepared for release
- **THEN** every scale measures indexed source selection, the largest standard-map membership movement, and planned-review cancellation using only seeded local D1 and deterministic platform mocks

#### Scenario: Pull-up cost grows with queue size
- **WHEN** D1 statements or writes increase across tenfold scales or rows read and latency show an unexplained material regression
- **THEN** release remains blocked until the query, index, fixture, or implementation is corrected and the report is regenerated
