## ADDED Requirements

### Requirement: Game modes use additive migration 0002
Migration `0002` SHALL add non-null compact game-mode fields to help requests and raid groups with PvE as the database default. It SHALL treat every pre-migration help request and raid group as PvE, replace active-request and compatible-raid indexes with mode-aware forms, add an outstanding mode-order index, and install membership compatibility triggers. Migration `0001` SHALL remain unchanged.

#### Scenario: Existing production data is migrated
- **WHEN** migration `0002` is applied to a database containing pre-mode requests and raids
- **THEN** every existing record remains usable as PvE with its prior identity, membership, state, and order

#### Scenario: Old Worker writes during deployment
- **WHEN** migration `0002` is applied before the new Worker begins serving and the previous Worker inserts a request or raid
- **THEN** the database assigns PvE by default and the record remains valid for the new Worker

#### Scenario: Mode-aware uniqueness is enforced
- **WHEN** migration `0002` has completed
- **THEN** D1 permits the same viewer and map in different modes but rejects a duplicate active request for the same viewer, mode, and map

### Requirement: Mixed-mode performance evidence gates release
Before release, the local D1 benchmark SHALL seed a deterministic mix of PvP Seasonal, PvP, and PvE records at the existing tenfold sizes through 100,000 requests. It SHALL exercise every existing user-facing benchmark operation with mode-aware data and SHALL produce an updated report containing latency, D1 rows read, and D1 rows written for each operation and size without contacting a remote D1 database. D1 row statistics SHALL be the primary cost evidence. Release SHALL NOT proceed until the report exists and any material regression from the previous report has been reviewed and explained.

#### Scenario: Mode-aware benchmark is run
- **WHEN** performance evidence is prepared for this change
- **THEN** the benchmark uses only seeded local D1 data, includes all three modes, retains comparable 10x size points through 100,000 requests, and reports latency plus D1 rows read and written for every user-facing operation and size

#### Scenario: Pre-release benchmark evidence is missing
- **WHEN** the accepted release commit does not have a complete updated mixed-mode benchmark report or an unexplained material regression remains
- **THEN** release is blocked until the evidence is produced and reviewed

## MODIFIED Requirements

### Requirement: Rollback preserves live data by default
Rollback SHALL restore a previous verified Worker version when that version can preserve the active schema semantics. Deployment SHALL record a D1 Time Travel bookmark, but SHALL NOT automatically restore the database after failure. Additive migration `0002` SHALL remain structurally usable by the previous Worker during the migration-to-deployment interval because new game-mode fields default to PvE. After the new Worker accepts a PvP Seasonal or PvP request, recovery SHALL prefer a forward repair because a pre-mode Worker cannot preserve mode-safe grouping.

#### Scenario: Health check fails before a non-PvE request exists
- **WHEN** the new Worker does not pass health validation before it accepts a PvP Seasonal or PvP request
- **THEN** the operator can restore verified Worker code without automatically discarding D1 writes

#### Scenario: Failure occurs after non-PvE data exists
- **WHEN** the deployed Worker has accepted PvP Seasonal or PvP data and then fails validation
- **THEN** the operator repairs or redeploys mode-aware code instead of restoring behavior that can mix game modes
