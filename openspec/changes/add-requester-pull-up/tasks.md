## 1. D1 Schema and Repository

- [x] 1.1 Add immutable migration `0003` with the ordered partial planned-source index, then add migration checksum, schema, and query-plan tests that prove full source raids use the index.
- [x] 1.2 Add repository source discovery for the first eligible later same-mode and same-map raid, including Priority-before-Ordinary ordering and all source-state exclusions.
- [x] 1.3 Implement one atomic requester pull that revalidates destination capacity and source membership, preserves membership history, and promotes only the selected Ordinary request when it enters Priority.
- [x] 1.4 Add the bounded all-or-nothing push-down into the immediate eligible source-queue successor, including empty-source closure and rollback of the complete transition on any failure.
- [x] 1.5 Add repository integration tests that cover every repository scenario in the delta specs and the full decision matrix: Ordinary and Priority destinations; permitted and forbidden source queue kinds; same and different modes and maps; source ordering; every excluded source and push-target state; zero, one, and maximum requester-capacity boundaries for each configured map; empty, fitting, and non-fitting remainders; stale destination, source, membership, and capacity changes; concurrent selections; request promotion; membership history; source closure; and transactional rollback at each write boundary.
- [x] 1.6 Add invariant or property-based regression tests that prove no transition exceeds map requester capacity, crosses a map or mode, pulls more than the selected requester, promotes an unselected Ordinary request, partially moves a source remainder, performs more than one push-down, changes attempts or leaders, or creates a Discord or Twitch call.

## 2. Discord Raid Details

- [x] 2.1 Add a versioned `Pull requester up` component to reviewed planned raid details only when the destination has requester capacity, while retaining safe handling for components already posted during deployment.
- [x] 2.2 Implement the authorized button interaction and private candidate selector with each source member's Twitch identity and goal, plus short responses for no candidate, stale state, and denied access.
- [x] 2.3 Apply a selected pull, re-render the original raid detail message, refresh the canonical board, and report whether the source closed, pushed down, or retained its remainder without sending requester calls.
- [x] 2.4 Add Discord workflow tests that cover every interaction scenario in the delta specs: streamer and volunteer authorization; unauthorized users; button visibility at every capacity and raid-state boundary; candidate ordering and labels; no-candidate and stale responses; Ordinary-to-Ordinary and Ordinary-to-Priority selection; successful, rejected, and retained push-down results; canonical board refresh; multiple simultaneous detail messages; manually deleted board and detail messages; legacy component identifiers; repeated and concurrent interactions; Discord response deadlines; and absence of Discord or Twitch calls.
- [x] 2.5 Create a test traceability matrix that maps every scenario in both delta specifications to at least one automated schema, repository, invariant, Discord workflow, or benchmark test, and close every uncovered combination or boundary before release.

## 3. Performance, Documentation, and Release Verification

- [x] 3.1 Extend the fully local benchmark seed and harness with pull-source selection and the maximum bounded pull with successful push-down at every tenfold scale from 100 through 100,000 active requests.
- [x] 3.2 Regenerate the benchmark report with latency, D1 rows read, D1 rows written, and statement counts; investigate and resolve any scale-dependent statement or write count or material row-read or latency regression.
- [x] 3.3 Update ASD-STE100 operator documentation for `Pull requester up`, Ordinary-to-Priority promotion, bounded push-down results, and the fact that pulling does not call a requester or start a raid.
- [x] 3.4 Run formatting, linting, type checking, dead-code and static analysis, migration and checksum checks, documentation and workflow checks, tests, build, secret scan, strict OpenSpec validation, and diff validation.
- [x] 3.5 Verify the completed implementation against every proposal, design, and delta-spec requirement and confirm that the automated traceability matrix has no uncovered scenario.

## 4. Publish and Deploy

- [ ] 4.1 As the final task, create a Git branch for this change, commit all change-scoped files, push the branch, create a GitHub pull request with the verified behavior and benchmark evidence, manually deploy that exact branch commit to the user's DEV environment, and smoke-test Ordinary-to-Ordinary pull, Ordinary-to-Priority pull, successful push-down, retained remainder, stale selection, multiple raid details, deleted details, and no-call behavior.
