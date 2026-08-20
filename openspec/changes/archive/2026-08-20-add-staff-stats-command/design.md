## Context

The bot retains help requests, raid groups, and membership history in D1. A successful raid preserves its Discord leader ID, Helped outcome, completion time, and completed membership rows. Removed historical memberships remain distinguishable. Migration `0004` backfills a singleton summary and one compact row per credited leader from this authoritative history, then D1 triggers maintain those rollups in the same transaction as each source change.

Both new commands are Discord-only, staff-only, and restricted to the configured staff channel. Their responses are ephemeral, so they do not need the canonical-board lifecycle, persistent Discord message IDs, deletion recovery, or Twitch-compatible names. `/stats` has no components. `/users` uses stateless page controls over the existing Twitch-first `user_mappings` table. The existing volunteer-role check, streamer ID, and staff-channel ID define authorization.

## Goals / Non-Goals

**Goals:**

- Give the streamer and volunteer sherpas a concise all-time impact snapshot.
- Define unambiguous request, raid, and leader-attribution counts.
- Render one bounded list-based embed without pings or persistent state.
- Let staff inspect Twitch, Discord, and Escape from Tarkov identity state in bounded pages, add absent Discord or in-game details, and reuse `/link-twitch` for corrections.
- Keep the `/stats` repository query read-only and scale-independent, and measure both its reads and the rollup triggers' bounded indexed write-path costs through 100,000 retained requests.

**Non-Goals:**

- Add `!stats`, `!users`, viewer statistics, public leaderboards, statistics date ranges, statistics pagination, Refresh, or Delete controls.
- Distinguish no-shows from other cancellations.
- Report historical attempt counts, because whole-raid postponement resets the current attempt fields.
- Store volunteer profiles, resolve Discord names through an external API, or add scheduled rollup jobs.
- Add arbitrary identity overwrites, user search or filtering, manual Twitch-ID entry, or stored directory page sessions.

## Decisions

### Use a Discord-only staff command

Add `/stats` to the Discord staff command configuration, but not to the shared public command-name parser. Authorize it with the same configured streamer ID, volunteer role, and staff-channel restriction used by staff-board access. An unauthorized caller or a caller outside the configured staff channel receives a short ephemeral denial containing no statistics.

The command may be invoked only in the configured staff channel. The response remains caller-only, but the channel restriction keeps all staff tools in one intentional Discord surface and prevents staff operations from appearing in viewer channels. Alternative considered: allow the ephemeral command in every guild channel. That makes the command harder to discover and operate consistently with `/board`.

Apply the same Discord-only authorization and staff-channel rule to `/users` and every `/users` component or modal interaction. Neither command is added to `PUBLIC_COMMAND_NAMES`, so Twitch chat treats `!stats` and `!users` as ordinary text. Alternative considered: make the directory a viewer self-service command. It contains other users' association and in-game details and therefore remains staff-only.

### Return one ephemeral snapshot embed

The interaction response uses the ephemeral message flag and exactly one embed. The embed title identifies all-time sherpa statistics. One list shows Submitted, Helped, Open, Canceled, and Successful raids. A second ordered list shows up to ten leaders as `<@Discord ID> — N requests (R raids)`, followed by an omitted-leader count when necessary. `allowed_mentions.parse` remains empty so rendering a leader does not notify them.

The response contains no components. It is not stored in D1, refreshed, deleted by the bot, linked from the board, or reconciled later. Its values are a snapshot at invocation time. Alternative considered: a persistent statistics message with Refresh and Delete controls. The caller-only requirement removes the need for message lifecycle management.

### Render users as a stateless keyset directory

`/users` returns an ephemeral embed with at most ten `user_mappings` rows ordered by normalized `twitch_login`, which is already the table primary key. Each row states whether Twitch's stable ID has been observed, renders a linked Discord member or `Not linked (optional)`, and renders the Escape from Tarkov name or `Missing`. Numeric platform IDs are not printed as text and allowed mentions remain empty.

Next uses `WHERE twitch_login > :last ORDER BY twitch_login LIMIT 11`. Previous uses `WHERE twitch_login < :first ORDER BY twitch_login DESC LIMIT 11` and reverses the returned page for display. The extra row determines whether the next control is available. A `Complete user details` string selector lists only incomplete users on the displayed page. Versioned component IDs carry the action, target login where applicable, and bounded page edges; they fit below Discord's 100-character custom-ID limit because Twitch logins are at most 25 characters. Every interaction reauthorizes the caller and queries current D1 state. No `OFFSET`, page number, page record, or message identity is stored.

Alternative considered: page numbers with SQL `OFFSET`. Later pages would read every preceding row and violate scale-independent pagination. Alternative considered: filters and search. They require more UI, indexes, and ambiguity about missing-but-optional fields and are not needed to inspect the current small community.

### Add only absent identity details

Selecting an incomplete mapping replaces the page with an ephemeral detail view. If Discord is absent, a native Discord user selector lets staff add one member. If the Escape from Tarkov name is absent, `Add EFT name` opens a one-field modal with the existing 1–64 character validation. `Back to users` reconstructs the originating keyset page from bounded cursor data in the component ID.

Each write uses an interaction receipt and a conditional `UPDATE ... WHERE field IS NULL`, followed by a fresh mapping read. This prevents a stale missing-detail control from overwriting a value supplied by the viewer or another staff member. Discord association also preserves the existing unique-member constraint and stores the resolved display name. The view removes a control after its field becomes complete and never pings the selected member.

Present values are not editable here. The view identifies `/link-twitch` as the existing intentional correction command. Stable Twitch ID remains system-observed when that viewer uses the bot on Twitch; staff cannot type it manually. Alternative considered: allow every field to be overwritten in `/users`. That duplicates correction semantics and makes an accidental directory click destructive.

### Define helped work through terminal membership

Summary counts come from `help_requests.state`: every row is submitted, waiting and planned are open, completed is helped, and canceled is canceled. A successful raid is a terminal `raid_groups` row with the Helped outcome.

Leader attribution joins only completed membership rows to successful raids and groups by `leader_discord_user_id`. This credits a multi-requester raid once per completed requester and once per raid. Removed memberships and Not Run groups do not count. Ranking uses helped requests descending, successful raids descending, then Discord user ID for deterministic ties.

### Maintain compact statistics rollups transactionally

Migration `0004` creates one `staff_statistics_summary` singleton row and one `staff_leader_statistics` row per credited Discord leader. It backfills both tables from authoritative source history. D1 triggers update the same rollups in the transaction that inserts, deletes, or changes a help request, successful raid, completed membership, or successful raid leader. The source tables remain authoritative and source-equivalence tests cover every supported transition and repair path.

The repository reads exactly one summary row and at most ten leader rows ordered by helped requests, successful raids, and Discord user ID. The summary stores the total credited-leader count so omitted leaders do not require an aggregate scan. `/stats` therefore uses two read-only statements, writes nothing, and has a row-read cost independent of retained history.

Alternative considered: query authoritative history on each invocation. The fully local D1 benchmark measured 234,318 rows read at 100,000 retained requests, which is excessive for a brief staff snapshot. Alternative considered: a scheduled rollup. It makes statistics stale and adds scheduling and recovery work that transaction-local D1 triggers avoid.

### Gate the read path on local D1 evidence

Extend the existing stable benchmark with the full Discord `/stats` interaction at 100, 1,000, 10,000, and 100,000 retained requests. Seed every state and attribution boundary, including more than ten leaders and equal rankings. Report statements, rows read, rows written, D1 duration, and wall time.

The `/stats` statement count and median row reads must stay constant across scales, and the command must write zero rows. The benchmark also measures representative request and raid-result mutations. Their statement and write counts must stay constant, and their indexed reads must remain within a small explicit cross-scale range with no history scan. Any unexplained growth requires query, trigger, schema, or fixture work and a regenerated report before release. The benchmark remains fully local.

Measure `/users` at first, middle, and last keyset positions across the same scales using mixed identity completeness. Statements, rows read, and writes must remain independent of the number of preceding pages. Measure one missing-Discord completion as the representative bounded write path and cover missing-EFT completion with correctness tests. Existing primary-key ordering should require no migration; query-plan and benchmark evidence must confirm that assumption.

## Risks / Trade-offs

- [A rollup drifts from authoritative history] → Backfill from source tables, update rollups in the same D1 transaction through triggers, and compare rollups with direct source aggregation after every supported transition in integration tests.
- [Rollup triggers make common writes expensive] → Measure representative request and raid-result mutations through 100,000 retained rows, require constant statements and writes, and reject more than 32 rows of cross-scale read growth.
- [A Discord mention could notify a leader] → Return the embed with empty allowed-mention parsing and test the payload.
- [A long leaderboard exceeds Discord limits] → Display at most ten ranked leaders and an omitted count; test worst-case IDs and counts against embed limits.
- [A user directory page exposes identity details] → Require current staff authorization on the command and every page interaction and return only ephemeral responses.
- [Later user pages degrade into large scans] → Use primary-key keyset boundaries rather than `OFFSET` and benchmark first, middle, and last positions through 100,000 mappings.
- [A Discord component boundary is malformed or stale] → Parse versioned IDs strictly, reauthorize, and return a short ephemeral restart message without revealing a page.
- [Concurrent completion overwrites identity data] → Update only a still-null field and return restart guidance when the conditional write loses.
- [Staff select a Discord member already linked elsewhere] → Preserve the unique mapping constraint, change nothing, and return a short conflict response.
- [Canceled is interpreted as no-show] → Label the value only as Canceled because the schema stores no reason.
- [Historical membership overcounts a moved requester] → Join only completed membership rows belonging to successful raids.
- [Concurrent state changes produce a mixed snapshot across statements] → Execute the bounded reads in one D1 batch and document the response as an invocation-time snapshot.

## Migration Plan

1. Apply additive migration `0004`; it backfills rollups from all retained source history before it installs the maintenance triggers.
2. Deploy the Worker that reads the rollups and adds `/stats` and `/users` to the Discord guild command configuration.
3. Re-run idempotent Discord command registration for the DEV guild.
4. Run the complete local benchmark and verification suite before deployment.
5. Smoke-test streamer access, volunteer access, unauthorized denial, empty data, ranked data, omitted leaders, caller-only visibility, user identity labels, forward and backward pagination, missing Discord and EFT completion, stale controls, and `/link-twitch` correction guidance in DEV.
6. If validation fails after migration `0004`, restore the prior Worker only when it does not invoke `/stats`; preserve the additive tables and use a forward migration to repair any rollup defect.

## Open Questions

None. The user selected Discord-only staff access, all-time scope, an ephemeral list-based statistics embed, ranking by requests helped with successful raids in parentheses, and a paginated staff user directory that can add absent Discord or Escape from Tarkov details.
