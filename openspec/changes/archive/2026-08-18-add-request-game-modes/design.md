## Context

The live bot accepts one map and goal on Twitch and opens a five-component request modal on Discord. Requests and raid groups persist only `map_id`; automatic materialization, duplicate prevention, requester follow-ups, board ordering, queue facts, and calls therefore cannot distinguish game modes. Discord permits at most five modal components, so the existing modal cannot contain a sixth selector. Migration `0001` is recorded and deployed and must remain immutable.

The board currently shows at most three Priority and seven Ordinary raids in FIFO order. Mode support must prevent a dominant mode from occupying every visible slot when another mode has outstanding work, without imposing proportional quotas or a stateful scheduler.

## Goals / Non-Goals

**Goals:**

- Require PvP Seasonal, PvP, or PvE on every new request.
- Preserve compact storage and enforce mode compatibility in D1.
- Keep FIFO order within a mode while reserving at least one visible raid for every non-empty mode.
- Use the same deterministic mode-presence ordering for board visibility and reported raids ahead.
- Deploy one additive migration that interprets all pre-mode data as PvE.
- Keep database reads bounded and extend the local performance evidence for mixed-mode data.

**Non-Goals:**

- Separate Discord boards, commands, or infrastructure for each mode.
- Equal, proportional, or weighted allocation of visible slots among modes.
- Game-mode preferences on user identity records.
- Mode-specific map catalogs, party capacities, attempt limits, or sherpa roles.
- Behavioral rollback to a Worker version that predates game modes after non-PvE requests exist.

## Decisions

### Use one canonical domain enum and compact D1 codes

The domain exposes `pvp-seasonal`, `pvp`, and `pve` with display labels `PvP Seasonal`, `PvP`, and `PvE`. The repository maps them to integer codes `0`, `1`, and `2`. Help requests and raid groups both store the mode. Keeping the mode on a raid makes board reads and calls independent of member joins and makes the grouping invariant explicit.

A text column was rejected because the values repeat in every request, raid, and relevant index. Inferring mode from goals, maps, or identities was rejected because mode belongs to each request.

### Put the Discord selector on the slash command

`/request` gains one string option named `mode` with the three display choices and Discord registration flag `required: true`. Discord therefore prevents command submission and modal opening until the viewer selects a mode. The selected canonical value is encoded in a versioned request-modal custom ID, and the existing Twitch name, in-game name, map, objective, and notes components remain unchanged. A legacy `request:create:v1` modal submitted during deployment is accepted as PvE; new modal IDs require a valid encoded mode.

Adding a sixth modal field was rejected because the modal is already at Discord's five-component limit. Removing or merging an existing request field and adding a second interaction step were rejected because both make the viewer flow less clear.

### Parse the longest Twitch mode alias before the map

Twitch uses `!request [mode] [map] [goal]`. PvP Seasonal accepts `pvp-seasonal`, the two-token alias `pvp seasonal`, and the short alias `seasonal`; PvP accepts `pvp`; PvE accepts `pve`. Parsing tests the longest aliases first so `pvp seasonal` is not consumed as PvP followed by an invalid map. Missing or unknown modes return short guidance with the accepted values. Map-prefix parsing, the optional default goal, and length limits remain unchanged after mode extraction.

### Make mode part of request identity and every grouping key

Active request uniqueness becomes `(twitch_login, game_mode, map_id)`, which permits one viewer to request the same map in different modes. Automatic materialization buckets by `(is_priority, game_mode, map_id)`. Compatible-raid lookup, new raid creation, requester-postponement destination selection, and dedicated follow-up creation all carry or compare mode.

D1 membership triggers reject an open membership when the request and raid differ in mode, map, or queue kind. Application checks remain for useful errors, while the trigger prevents later code paths from silently mixing incompatible players.

### Use mode-presence ordering instead of balanced round-robin

Priority and Ordinary are ordered independently. For each section, the repository obtains a bounded FIFO prefix for each mode. The shared ordering function takes the oldest outstanding raid from every non-empty mode, orders those heads by the existing stable raid key, and then appends all remaining candidates in normal FIFO order. The section limit is applied after this merge.

This reserves at least one visible raid for each non-empty mode. It permits `6/1` or `5/1/1` distributions when demand is skewed and permits all seven Ordinary slots to share one mode only when the other modes have no outstanding raids. Strict round-robin and fixed per-mode quotas were rejected because they overstate fairness when a mode has little demand and reorder more work than necessary.

Board candidate reads use the new `(is_priority, game_mode, sort_key)` outstanding index and a per-mode `LIMIT` equal to the section limit. At most nine Priority and twenty-one Ordinary candidates are transferred before the merge. Active and planned raids both participate, and existing total counters and the three/seven display limits remain unchanged.

### Make Queue mode-scoped and consistent with the board

Queue selects the caller's next request in priority-first arrival order, reports its mode and map, and calculates request ordinal only among active requests in that mode. Other active requests are labeled with both mode and map. Raids-ahead uses Priority before Ordinary and the same mode-presence merge as the board. Bounded per-mode prefixes preserve the existing exactness limits; a result outside the prefix reports the existing lower bound.

Keeping a global request ordinal was rejected because it would imply an execution order that the mode-presence board does not use. Giving Queue a different raid order from the board was rejected because staff and viewers would receive contradictory expectations.

### Show mode at every operational decision point

User confirmations, duplicate replies, Queue, board fields, start selectors, raid-detail titles, Discord calls, and Twitch calls use `Mode · Map`. Participant details do not repeat mode because it is a raid-level property. Internal references and stored integer codes remain hidden.

### Add one forward-compatible migration

Migration `0002` adds non-null `game_mode` columns to `help_requests` and `raid_groups` with PvE code `2` as the default. SQLite applies that default to existing rows and to any request accepted by the old Worker between migration and deployment. The migration replaces the active-request uniqueness and compatible-raid indexes with mode-aware forms, adds the outstanding mode-order index, and installs compatibility triggers. The migration checksum is recorded only after SQL and tests are final.

The release deploys migration and code together. The previous Worker remains structurally usable during the migration-to-deployment interval because added columns have defaults. After the new Worker accepts PvP Seasonal or PvP requests, recovery prefers a forward fix; rollback to pre-mode behavior is not promised because it cannot preserve mode grouping.

### Extend deterministic tests and local benchmarks

Unit tests cover aliases, Discord choice and modal-state parsing, validation, labels, and fairness ordering. Integration tests cover migration backfill, uniqueness per mode, trigger rejection, materialization, follow-ups, board diversity, Queue facts, calls, and legacy PvE modal submission. The existing local D1 benchmark keeps its 10x sizes through 100,000 requests and seeds a deterministic skew across all three modes. Its pre-release report records updated latency plus D1 rows read and rows written for every user-facing operation at every size. D1 row statistics are the primary cost evidence; latency is supporting performance evidence. The release cannot proceed until the report is produced and any material regression from the previous report is understood. Single-mode and minority-mode board cases remain focused correctness tests rather than additional benchmark matrices.

## Risks / Trade-offs

- [A newly non-empty mode moves its head ahead of older deep raids from another mode] → Document that cross-mode order is mode-presence based while FIFO remains stable inside each mode.
- [Mode-aware Queue prefixes read up to three bounded mode prefixes] → Keep hard row limits, add the compound indexes, and compare benchmark statement and row counts before release.
- [A Discord modal opened before deployment submits without encoded mode] → Accept only legacy modal version 1 as PvE and emit only mode-aware version 2 afterward.
- [Old code cannot safely process non-PvE mode semantics after launch] → Use additive defaults during deployment and prefer a forward repair after the feature begins receiving new modes.
- [A mode label is omitted from an operational message] → Centralize display formatting and cover every public and staff surface with tests.

## Migration Plan

1. Commit the previously archived delivery change separately so this change starts from a clean OpenSpec baseline.
2. Implement and test mode-aware domain, intake, repository, board, Queue, calls, and benchmark behavior.
3. Finalize `0002`, record its checksum, and verify it against a seeded copy of the current schema with existing rows.
4. Run complete local verification and the mixed-mode local D1 benchmark, produce the updated latency and D1 row-statistics report, and review changes against the previous report before release.
5. Deploy through the protected production workflow, which records the D1 recovery bookmark before applying `0002`.
6. Verify all three request modes, same-mode grouping, mode-presence board ordering, Queue output, and both call platforms in the maintainer environment.
7. Publish and deploy the accepted patch to the streamer fork, then repeat the focused smoke test.

## Open Questions

None.
