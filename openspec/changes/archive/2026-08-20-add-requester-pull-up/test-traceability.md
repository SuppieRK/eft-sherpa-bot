# Requester pull-up test traceability

## Raid planning scenarios

| Specification scenario | Automated evidence |
|---|---|
| Ordinary reviewed raid has an open seat | Repository test `pulls one requester and pushes the complete source remainder into one successor`; unit and Discord tests `shows Twitch nicknames with goals and pulls without starting or calling` verify the direct review selector |
| No eligible source exists | Unit test `shows Pull requester up only during a planned frozen review with capacity`; Discord test `returns a short response when no safe pull source remains` verifies the disabled selector and its unavailable label |
| Earlier later raid is incompatible | Repository test `skips different modes and maps before selecting the first compatible source` |
| Source is not safe to modify | Repository tests `does not offer a reviewed or leader-reserved source` and `never pulls a requester from a concurrent volunteer-led active raid`; equivalent Discord active-raid test |
| Selected requester is pulled | Repository pull-and-push test and Discord happy-path test |
| Selection becomes stale | Repository tests `rejects a stale source selection without moving any requester` and `allows only one concurrent pull of the same requester` |
| Staff review a raid after deleting its details | Discord test `dismisses a deleted planned detail when staff review the raid again` |
| Board refresh finds a deleted reviewed detail | Discord test `dismisses a deleted planned review without assigning a leader or calling users` |
| Board refresh finds a deleted active detail | Discord test `recreates a deleted active raid message without changing attempt state or pinging users` |
| Staff cancel a planned review | Repository test `dismisses only the matching planned review and cannot clear active details`; Discord test `cancels one planned review without changing its raid or other details` |
| Staff use a stale Cancel review control | Repository and Discord stale-message assertions in the cancellation tests |
| Raid starts before cancellation commits | Repository test `serializes review dismissal against raid start`; Discord active-control rejection assertion |
| Discord cannot delete the review | Discord test `accepts a missing Cancel target and restores the link after another deletion error` covers both `404` and restoration after another error |
| Postponed Priority raid pulls from Ordinary | Repository test `promotes only the selected Ordinary requester into a reviewed Priority raid`; local maximum pull benchmark |
| Later Priority source exists | Repository test `uses a later Priority source before an Ordinary source` |
| Ordinary destination requests candidates | Repository test `never offers a Priority source to an Ordinary destination` |
| Complete remainder fits in the next raid | Repository pull-and-push test and local maximum pull benchmark |
| Source becomes empty from the pull | Discord happy-path test `shows Twitch nicknames with goals and pulls without starting or calling` |
| Complete remainder does not fit | Repository test `retains the complete source party when the immediate successor cannot fit it` |
| Immediate compatible raid is frozen | Repository test `stops push-down at a reviewed compatible boundary` |
| Ordinary source follows a Priority destination | Repository Priority-promotion test and local maximum pull benchmark |
| Push write fails | Repository test `rolls back the complete pull when a push membership write fails` |

## Deployment scenarios

| Specification scenario | Automated evidence |
|---|---|
| Pull source can be full | Schema query-plan test `uses the ordered pull-source index for full planned raids` |
| Previous Worker is restored | Migration checksum validation, the six-table schema regression test, and the complete pre-existing repository and Discord suites |
| Pull-up benchmark is generated | Benchmark operations `discord.requester.pull.candidates`, `discord.requester.pull.with-push`, and `discord.raid.review.cancel` at all contract scales |
| Pull-up cost grows with queue size | Benchmark report guard for scale-independent statement and write counts and material row-read growth |

## Cross-cutting boundaries and invariants

| Boundary or invariant | Automated evidence |
|---|---|
| Every configured map keeps one place for the sherpa | Parameterized repository test `enforces $name requester capacity during a pull` |
| Pull does not start attempts or calls | Discord happy-path state and outbound-call assertions |
| Twitch nickname and goal identify each option | Unit test `labels pull candidates with Twitch nicknames and describes them with goals` and Discord selector assertion |
| Deleted planned detail messages are dismissed | Discord tests `dismisses a manually deleted destination detail after a pull` and `tracks multiple raid detail messages through recovery and independent actions` |
| Concurrent planned-detail dismissal clears one stale link | Discord test `clears one stale link when deleted-detail review actions overlap` |
| Deleted active detail messages recover | Discord test `recreates a deleted active raid message without changing attempt state or pinging users` |
| Unauthorized viewers cannot pull | Discord test `denies pull controls to a non-staff user` |
| Multiple active and reviewed raids stay independent | Concurrent volunteer-led active-raid repository and Discord tests |
| Cancel review is planned-review only and preserves other details | Unit planned/active render assertions and Discord independent-detail cancellation test |
