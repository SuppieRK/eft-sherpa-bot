## REMOVED Requirements

### Requirement: Attempt limit is configurable
**Reason**: Replace retired queue categories and raid-attempt controls with unified service ordering.
**Migration**: Preserve existing records through forward migration 0012 and use the current unified workflow.

## MODIFIED Requirements

### Requirement: Group materialization has no raid cap
The backend SHALL materialize all outstanding requests into stable raid groups subject only to map requester capacity. The staff board SHALL bound only its indexed page query.

#### Scenario: More than ten raids are outstanding
- **WHEN** materialization creates an eleventh raid
- **THEN** it remains durable and appears when it enters the page that contains its service position

### Requirement: Indexed bounded queue operations
Queue lookup SHALL fetch the authenticated caller first and use separate indexed capped-prefix reads for mode-scoped requester position and preceding raids. It SHALL read no more than 101 preceding nonempty same-mode raids with their maintained member totals and 51 preceding raids. The fixed exactness limits of 100 requests ahead and 50 raids ahead SHALL be committed policy, not runtime operator configuration. Compatible-raid lookup SHALL use a trigger-maintained current membership count and a partial mode, map, and stable-order index that excludes full raids. The unified board total SHALL use existing trigger-maintained counters in the existing community singleton. Raid membership reads SHALL use a group-and-position index.

#### Scenario: Queue contains many active requests
- **WHEN** one viewer invokes Queue
- **THEN** the backend does not transfer or draft every active request and its prefix reads remain bounded by the committed limits

#### Scenario: Full compatible raids have accumulated
- **WHEN** materialization searches for an automatically fillable raid on one map
- **THEN** the indexed candidate read excludes full raids instead of scanning them and counting their memberships

## ADDED Requirements

### Requirement: Unified bounded display and query policy
All outstanding work SHALL remain durable. The shared board SHALL display ten raids per page. Queue queries SHALL retain capped 100-request and 50-raid exactness thresholds. Page reads SHALL be indexed keyset queries and SHALL NOT use OFFSET scans. Manual placement and resets SHALL reuse existing state and transactions and SHALL NOT renumber the complete list. Deployment SHALL have no raid-attempt policy.

#### Scenario: Backlog grows
- **WHEN** the local benchmark reaches 100,000 requests
- **THEN** query statements and writes remain bounded and page reads do not grow in proportion to page depth
