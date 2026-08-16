## ADDED Requirements

### Requirement: Public repository starts from a sanitized root
The upstream repository SHALL contain one clean initial commit without the private-pilot Git history, local secret files, tracked production credentials, or pilot platform IDs.

#### Scenario: Initial repository is published
- **WHEN** `SuppieRK/eft-sherpa-bot` becomes public
- **THEN** its root history contains only the verified sanitized snapshot

### Requirement: Every release commit is deployed from upstream
Before a release is created, the exact upstream `main` commit SHALL deploy through the same production workflow and environment contract used by streamer forks. The upstream environment SHALL use maintainer-owned test platform resources and a disposable non-production D1 database.

#### Scenario: Deployment belongs to another commit
- **WHEN** release automation cannot find successful upstream deployment evidence for the target SHA
- **THEN** release creation fails

### Requirement: Deployment produces bounded evidence
Deployment SHALL record repository, commit, version, Worker URL, D1 database name, migration names, recovery bookmark, platform validation results, health results, and start and finish times. Evidence SHALL NOT contain secrets or user data.

#### Scenario: Deployment completes
- **WHEN** all deployment and validation stages finish
- **THEN** GitHub stores a summary and evidence artifact for the exact commit

### Requirement: Release requires platform smoke-test confirmation
Release automation SHALL require explicit confirmation that the documented Discord and Twitch smoke test passed after the upstream deployment.

#### Scenario: Smoke test is incomplete
- **WHEN** the maintainer starts release publication without confirming the smoke test
- **THEN** no tag or GitHub release is created

### Requirement: Releases use semantic versions
The release workflow SHALL create the semantic tag and GitHub release only after CI, upstream deployment, and smoke-test gates pass. Release notes SHALL state migrations, compatibility, operator actions, and rollback information.

#### Scenario: Initial release passes all gates
- **WHEN** the verified initial commit and smoke test are complete
- **THEN** the workflow creates `v0.1.0` and its release notes
