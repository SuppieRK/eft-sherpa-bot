# Requester pull-up test traceability

## Raid planning scenarios

| Specification scenario | Automated evidence |
|---|---|
| Ordinary reviewed raid has an open seat | Repository test `pulls one requester and pushes the complete source remainder into one successor`; Discord test `shows Twitch nicknames with goals and pulls without starting or calling` |
| Earlier later raid is incompatible | Repository test `skips different modes and maps before selecting the first compatible source` |
| Source is not safe to modify | Repository tests `does not offer a reviewed or leader-reserved source` and `never pulls a requester from a concurrent volunteer-led active raid`; equivalent Discord active-raid test |
| Selected requester is pulled | Repository pull-and-push test and Discord happy-path test |
| Selection becomes stale | Repository tests `rejects a stale source selection without moving any requester` and `allows only one concurrent pull of the same requester` |
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
| Pull-up benchmark is generated | Benchmark operations `discord.requester.pull.candidates` and `discord.requester.pull.with-push` at all contract scales |
| Pull-up cost grows with queue size | Benchmark report guard for scale-independent statement and write counts and material row-read growth |

## Cross-cutting boundaries and invariants

| Boundary or invariant | Automated evidence |
|---|---|
| Every configured map keeps one place for the sherpa | Parameterized repository test `enforces $name requester capacity during a pull` |
| Pull does not start attempts or calls | Discord happy-path state and outbound-call assertions |
| Twitch nickname and goal identify each option | Unit test `labels pull candidates with Twitch nicknames and describes them with goals` and Discord selector assertion |
| Deleted detail messages recover | Discord test `repairs a manually deleted destination detail after a pull` |
| Unauthorized viewers cannot pull | Discord test `denies pull controls to a non-staff user` |
| Multiple active and reviewed raids stay independent | Concurrent volunteer-led active-raid repository and Discord tests |
