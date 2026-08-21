## MODIFIED Requirements

### Requirement: Static quality gates block deployment
Repository verification SHALL keep Biome as the sole formatter and baseline linter, run Oxlint with TypeScript 7 type-aware correctness and performance analysis for production code, run Knip for unused project files, exports, types, and dependencies, and reject every warning or finding. Oxlint SHALL explicitly enforce `typescript/no-misused-promises`, `typescript/require-await`, `no-await-in-loop`, `oxc/no-accumulating-spread`, `unicorn/prefer-set-has`, `unicorn/prefer-set-size`, and `unicorn/no-useless-spread`. Required sequential test, benchmark, authorization-polling, pagination, and deployment-retry loops SHALL use narrow rule overrides, while an intentional bounded production retry SHALL use a local documented suppression. The repository SHALL NOT add Gradle or literal Spotless solely for formatting.

#### Scenario: Dead or unsafe code is introduced
- **WHEN** Biome, Oxlint, TypeScript, or Knip reports a configured finding
- **THEN** local verification, pull-request CI, and the deployment workflow fail before Worker deployment

#### Scenario: Sequential work is required
- **WHEN** a loop must preserve fixture order, API pagination, authorization polling, retry delay, or a bounded materialization replan
- **THEN** the exception is scoped to that code instead of disabling production performance analysis globally

#### Scenario: Static-analysis tooling is deployed
- **WHEN** the zero-finding quality gates and their runtime cleanups pass complete verification
- **THEN** the operator deploys without resetting D1 or re-registering Discord commands
