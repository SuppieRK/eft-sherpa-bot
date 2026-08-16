## Context

Twitch is the primary acquisition and request surface. Discord is the detailed request alternative, one-way identity-linking surface, and staff operating surface. The private environment has no real users and its D1 database is disposable.

The superseded progressive board bound materialization and rollover to stored Twitch schedule segments. The implemented replacement treats the schedule as outside this MVP and models ordinary and postponed work directly.

## Goals

- Keep requests, raids, board controls, and calls available at every time of day.
- Give postponed unresolved raids a distinct visible queue without weakening FIFO fairness.
- Let the streamer understand and operate the next raids without remembering attempt counts.
- Preserve stable grouping and positions without a backend raid cap or board pagination.
- Reduce the data model and deployment surface after removing schedule state.

## Non-Goals

- Twitch Schedule API storage, polling, display, session boundaries, or automatic time rollover.
- Pagination, a web dashboard, setup UI, runtime configuration editing, or arbitrary queue promotion outside `Postpone raid`.
- Availability, attendance, objective compatibility analysis, call retries, audit history, or production backups.
- Discord invitation commands, public launch, or streamer-owned infrastructure during this change.

## Viewer Interface

| Intent | Discord | Twitch |
|---|---|---|
| Start a request | `/request` | `!request <map> [goal]` |
| View queue and own status | `/queue` | `!queue` |
| Associate Discord | `/link-twitch name:<Twitch name> [eft:<in-game name>] [discord:@member]` | Not needed |

Queue takes no arguments. For a caller with an active request, it reports the caller's next map, global priority-first request ordinal, projected raids ahead, and other active maps. The ordinal is the request's place across all active requests, not a seat within one raid. A caller without an active request receives only short platform-specific request guidance. Public responses omit global aggregate totals, internal references, notes, stable IDs, and link state.

Every Discord reply that refers to a slash command renders the complete command reference inside backticks. This applies to successful guidance and private denial messages, including `/request`, `/queue`, `/link-twitch`, and `/board`.

Queue reads at most the first 101 preceding requests and 51 preceding raids. This keeps the response exact through 100 requests ahead and 50 raids ahead while bounding D1 row reads for later callers. When a prefix exceeds either exactness limit, the response uses `More than 100 requests ahead` or `more than 50 raids ahead` for that dimension. The request and raid dimensions cap independently, and Discord and Twitch render the same queue facts.

Twitch request intake resolves a hardcoded map alias and treats remaining text as the goal. A missing goal becomes `General raid help`. Discord uses a modal with required Twitch name, in-game name, map, and goal plus optional notes. Goal is 1–150 characters and notes are absent or 1–250 characters. The domain and D1 reject invalid text instead of truncating it.

## Queue Model and Materialization

The domain exposes `queueKind` as `ordinary` or `priority`. D1 stores it as the compact `is_priority` integer. New requests are ordinary. Whole-raid postponement is the transition to priority. Automatic materialization groups only requests of the same queue and map.

Each queue has independent sparse ordering keys. New ordinary raids append after every open ordinary raid, including active and reserved raids. Whole-raid postponement moves the same raid to the end of Priority. Individual postponement uses the free key space directly after its source. The bounded requester capacity guarantees sufficient midpoint key space, so the system has no normalization branch, fixed sentinel, or row-by-row position shift. The board derives current ordinal positions when it reads raids.

Materialization first reads waiting requests. If none exist, it returns without reading raids or memberships. Otherwise it reads only compatible automatically fillable raids through a partial queue-and-map index whose predicate includes remaining capacity. `raid_groups.current_member_count` is maintained by insert, delete, group-move, and state-change triggers on current memberships; the existing capacity triggers still validate actual memberships independently. Separate indexed scalar maxima cover every planned or active raid, including active and reserved raids that cannot accept automatic members. Materialization indexes compatible targets in queue-and-map buckets, computes assignments in linear time, then uses JSON table input and one D1 batch to insert new raids, insert memberships, and mark requests planned. The number of D1 write statements is fixed for a backlog.

For public queue facts, all priority work is ordered before ordinary work. A priority caller has only earlier priority raids ahead. An ordinary caller has every priority raid plus earlier ordinary raids ahead.

The baseline validates `raid_groups.map_id` together with `requester_capacity`. Every committed five-person map accepts at most four requesters and Icebreaker accepts at most two. Unknown maps are rejected. Membership triggers remain the final guard against inserting or moving more current requesters than the validated capacity, so every raid always retains one physical sherpa place even when the runtime recipient limit is raised.

## Canonical Staff Board

`/board` is allowed only in the configured staff channel for the streamer or volunteer role. It creates the canonical board message when none exists, repairs it when deleted, updates it otherwise, and returns an ephemeral message link.

The message contains two independent sections without a separate help-request or outstanding-raid counter:

- Priority: `Showing X of Y raids (up to 3).` and the first three outstanding priority raids using `LIMIT 3`.
- Ordinary: `Showing X of Y raids (up to 7).` and the first seven outstanding ordinary raids using `LIMIT 7`.

The limits are fixed and unused capacity is not borrowed by the other queue. Both queries use stable queue position and never use `OFFSET`. Each raid row shows map, physical occupancy, attempt state, planned or active state, and leader. Board and selector ordinals are derived from each already ordered visible queue array; the shared raid query does not calculate a correlated database position for every row. Only an active raid with a stored detail-message identity shows a raid-message link. Planned raids never show a detail link and remain available in the start selector.

`/board` and `Refresh` start bounded reconciliation for the visible active raids after the interaction response is prepared. For each stored detail-message identity, the Worker performs a Discord read. A successful read keeps the identity. A confirmed `404` atomically clears it before creating a replacement from current D1 raid state. A non-404 Discord error retains the identity and does not create a duplicate. An active raid without an identity is also eligible for recreation.

Replacement creation never pings the leader or requesters and does not change raid identity, queue, position, membership, leader, calls, attempt, or request state. D1 compare-and-set selects one replacement when refreshes overlap; a loser deletes its duplicate Discord message. If creation fails after a confirmed deletion, the identity remains empty and the canonical board omits the stale link until a later refresh retries. After reconciliation, the Worker rereads D1 and updates the canonical board.

The board controls remain `Refresh` and one `Start a raid` selector. The selector includes visible planned priority raids first, then visible ordinary raids, and labels each option with its queue. Active raids are not selectable.

## Starting, Calling, and Raid Details

Selecting a raid assigns the staff caller as leader, changes the raid to active, begins attempt one, posts a Discord call, and creates one persistent staff message. An ordinary or priority raid is claimable by any authorized staff member. A dedicated postponed raid remains restricted to its reserved leader or the streamer.

Streamer-led raids request a Twitch chat call even when the broadcaster has no published schedule. Volunteer-led raids remain Discord-only. Per-platform `pending`, `sent`, `failed`, or `not_requested` status is durable, and partial delivery failure does not roll back the raid.

The raid message shows full participant, goal, notes, leader, call, and attempt details. Only the assigned leader and streamer may record a result, postpone or remove a requester, or postpone the whole raid. The leader tag remains visible after every active update, but only initial message creation sends a notification.

Before the attempt limit, an unsuccessful result increments the counter without another call. On the final attempt, the result choices are `Helped` and `Postpone raid`. `Helped` completes the raid and requests. `Postpone raid` keeps the same raid and memberships, moves it to the end of Priority, resets attempts and calls, and retains the leader. Both clear and delete the obsolete detail message. A Discord deletion failure does not roll back durable state. No time or schedule event changes a raid.

Postponing a requester creates a dedicated same-map raid immediately after the source within the same queue. It reserves the source leader, cannot be automatically filled, and starts at attempt zero. If the source becomes empty, it becomes `not_run` and the dedicated raid takes its position.

Removing a requester cancels that help request and removes its membership so materialization cannot add it again. If the source becomes empty, it becomes `not_run` and its obsolete raid message is deleted.

Postponing a raid moves the same group to the end of the priority queue, returns it to planned state, resets attempts and call status, rejects automatic filling, and retains its leader and remaining active requests. An already-priority raid moves to the end of that queue. Its old raid message is deleted, and a later start creates calls and a fresh raid message.

## Six-Table Data Model

`help_requests` remains authoritative. Its integer primary key is both immutable arrival order and the source of the derived `C<id>` reference. It stores `is_priority` and compact integer state. `raid_groups` stores `is_priority`, a sparse `sort_key`, a trigger-maintained current membership count, compact integer state values, attempt state, leader, call statuses, automatic-fill eligibility, and Discord message identity. Outcomes are only `helped` and `not_run`; Try Again and retry-origin state do not exist. `raid_group_members` stores durable memberships and compact state. `community_state` stores the single canonical board message ID and trigger-maintained open-raid totals for the two fixed board queues. Its insert trigger backfills exact totals if the singleton is recreated after raids already exist. All timestamps are integer epoch milliseconds.

`raid_nights`, schedule segments, dates, generated request-reference columns, duplicated queue-sequence columns, and text retry keys are removed. Partial indexes cover active request order, caller lookup, active Twitch-and-map uniqueness, compatible same-map raids, outstanding raid order, and unique open membership. A general `(group_id, position)` membership index supports both current and historical raid reads.

## Reliability and Deployment

- Biome remains the sole formatter and supplies its recommended syntax lint. Oxlint adds its default high-signal correctness profile with TypeScript 7 type-aware analysis; warnings and stale suppression directives fail verification. Knip models both Vitest configurations and treats unused files, dependencies, exports, and types as failures. The only dependency exception is the Cloudflare runtime's virtual `cloudflare:` module.
- The first quality-gate adoption starts from zero findings. It removes dead code and fixes findings instead of recording a suppression baseline. Oxlint's suspicious, pedantic, performance, restriction, and nursery categories remain outside this adoption to avoid unrelated opinionated rewrites.
- Discord and Twitch signatures are verified before parsing private data.
- Mutating interactions use platform delivery IDs and group action keys for idempotency. Discord and Twitch signatures reject timestamps outside a ten-minute replay window.
- Delivery receipts use integer timestamps, omit an unused constant outcome, and expire after 24 hours during later receipt claims.
- D1 batches keep membership, result, attempt, ordering, and request state changes together. A failed requester postponement rolls back the full transition.
- `Helped` completes only requests in the source raid's current completed memberships; historical removed memberships cannot complete a postponed request.
- Queue facts fetch one caller request and add separate indexed capped-prefix reads for its global ordinal and preceding raids. They read at most 101 earlier requests and 51 earlier raids, do not load all active requests, use cross-priority `OR` ranges, or run draft grouping.
- Board totals read trigger-maintained ordinary and priority counters from the existing community singleton, and new-raid allocation reads ordinary and priority maxima through the existing open-raid order index.
- D1 compare-and-set protects active raid-detail message repair from concurrent `/board` or `Refresh` actions.
- Discord messages use explicit allowed-mention IDs and never parse broad mentions.
- Obsolete raid messages are deleted only after the durable state transition; deletion failure leaves safe, unusable controls and produces a private warning.
- Twitch and Discord credentials remain Worker or GitHub secrets.
- A full-Worker benchmark uses a dedicated all-zero local D1 binding and deterministic seeds at 100, 1,000, 10,000, and 100,000 active requests. It rejects remote configuration, mocks Discord and Twitch, and measures signed requests through awaited background work.
- Each operation and scale runs three warmups and ten measured samples. Reports retain wall-time and D1-duration distributions plus exact statement, row-read, and row-write counters. Deterministic cost invariants fail regressions; host-dependent millisecond values do not gate verification.
- Queue benchmark invariants require fewer than 200 D1 rows read for Discord and fewer than 220 for Twitch at every scale and measured percentile.
- Discord and Twitch Queue use callers at the deterministic 10th, 50th, and 90th percentiles. The benchmark uses the linked Discord request form, self-linking, streamer-led start, and Helped as the representative raid-result path.
- The disposable D1 database is reset. The current canonical board ID is preserved before reset when present and seeded into `community_state` afterward.
- The deployment has no scheduled trigger and `/internal/schedule/refresh` is removed.
- Tooling-only deployment does not reset D1 or re-register Discord commands. Runtime fixes discovered by analysis use the ordinary verified Worker deployment and endpoint checks.

## Private-Pilot Acceptance

The user completed manual testing and accepted the private-pilot workflow on 2026-08-16. The accepted pilot covered intake on both platforms without schedule data, personal queue status, the fixed three-plus-seven board, stale active-detail repair through `/board` and Refresh, starts at any time, conditional cross-platform calls, attempts, priority postponement FIFO, individual postponement and removal, whole-raid postponement, leader-tag retention, authorization, and duplicate delivery suppression.

This acceptance completes the internal MVP and makes the change ready for archival. It does not authorize streamer-owned deployment or public launch; those remain separate later work.

## Artifact Maintenance

Accepted pilot findings update the relevant proposal decision, design behavior, capability requirement and scenario, implementation task, and operator instruction directly. Superseded explorations and deployment snapshots remain available through Git history. The change does not keep a parallel feedback ledger.
