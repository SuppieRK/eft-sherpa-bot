## Context

The bot retains help requests, raid groups, and membership history in D1. A successful raid preserves its Discord leader ID, Helped outcome, completion time, and completed membership rows. Removed historical memberships remain distinguishable. This is enough to calculate accurate all-time request outcomes and per-leader successful work without a new identity system.

Both new commands are Discord-only and staff-only. Their responses are ephemeral, so they do not need the canonical-board lifecycle, persistent Discord message IDs, deletion recovery, or Twitch-compatible names. `/stats` has no components. `/users` uses stateless page controls over the existing Twitch-first `user_mappings` table. The existing volunteer-role check and streamer ID define authorization.

## Goals / Non-Goals

**Goals:**

- Give the streamer and volunteer sherpas a concise all-time impact snapshot.
- Define unambiguous request, raid, and leader-attribution counts.
- Render one bounded list-based embed without pings or persistent state.
- Let staff inspect Twitch, Discord, and Escape from Tarkov identity state in bounded pages, add absent Discord or in-game details, and reuse `/link-twitch` for corrections.
- Keep the repository query read-only and measure its real local D1 cost through 100,000 retained requests.

**Non-Goals:**

- Add `!stats`, `!users`, viewer statistics, public leaderboards, statistics date ranges, statistics pagination, Refresh, or Delete controls.
- Distinguish no-shows from other cancellations.
- Report historical attempt counts, because whole-raid postponement resets the current attempt fields.
- Store volunteer profiles, resolve Discord names through an external API, or add scheduled rollups.
- Add arbitrary identity overwrites, user search or filtering, manual Twitch-ID entry, or stored directory page sessions.

## Decisions

### Use a Discord-only staff command

Add `/stats` to the Discord staff command configuration, but not to the shared public command-name parser. Authorize it with the same configured streamer ID and volunteer role used by staff-board access. An unauthorized caller receives a short ephemeral denial containing no statistics.

The command may be invoked in the configured guild without requiring a public response. Because its response is caller-only, it does not need the staff-channel restriction that protects persistent board messages. Alternative considered: add matching `/stats` and `!stats` commands. Twitch has no reliable readable name for every Discord-only volunteer and would make the leaderboard inconsistent.

Apply the same Discord-only authorization rule to `/users`. Neither command is added to `PUBLIC_COMMAND_NAMES`, so Twitch chat treats `!stats` and `!users` as ordinary text. Alternative considered: make the directory a viewer self-service command. It contains other users' association and in-game details and therefore remains staff-only.

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

### Query source-of-truth tables directly

Add a repository statistics query that executes a constant bounded set of aggregate statements. The summary aggregation reads help requests. The leaderboard begins with successful raids and their completed memberships, returns only the first ten leaders plus the total credited-leader count, and writes nothing.

Do not add aggregate tables or write-path triggers before evidence requires them. The command is staff-only and expected to be infrequent; persistent counters would add write amplification and drift risk to every request and terminal transition. Existing records also become immediately visible with direct aggregation. Alternative considered: migration `0004` with materialized counters. That would make reads constant but complicate rollback, backfill, and every mutation for an infrequently used command.

### Gate the read path on local D1 evidence

Extend the existing stable benchmark with the full Discord `/stats` interaction at 100, 1,000, 10,000, and 100,000 retained requests. Seed every state and attribution boundary, including more than ten leaders and equal rankings. Report statements, rows read, rows written, D1 duration, and wall time.

Linear row growth is expected for exact all-time source-of-truth aggregation. Statement count must stay constant and writes must stay zero. Superlinear growth or unacceptable measured latency requires query or index work and a regenerated report before release. The benchmark remains fully local.

Measure `/users` at first, middle, and last keyset positions across the same scales using mixed identity completeness. Statements, rows read, and writes must remain independent of the number of preceding pages. Measure one missing-Discord completion as the representative bounded write path and cover missing-EFT completion with correctness tests. Existing primary-key ordering should require no migration; query-plan and benchmark evidence must confirm that assumption.

## Risks / Trade-offs

- [Exact all-time aggregation reads retained history] → Keep the command staff-only, use bounded aggregate statements, benchmark through 100,000 rows, and add persistent rollups only with evidence.
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

1. Add `/stats` and `/users` to the Discord guild command configuration and deploy the read-only Worker change.
2. Re-run idempotent Discord command registration for the DEV guild.
3. Run the complete local benchmark and verification suite before deployment.
4. Smoke-test streamer access, volunteer access, unauthorized denial, empty data, ranked data, omitted leaders, caller-only visibility, user identity labels, forward and backward pagination, missing Discord and EFT completion, stale controls, and `/link-twitch` correction guidance in DEV.
5. If validation fails, restore the prior Worker and command configuration; no D1 migration or data rollback is required.

## Open Questions

None. The user selected Discord-only staff access, all-time scope, an ephemeral list-based statistics embed, ranking by requests helped with successful raids in parentheses, and a paginated staff user directory that can add absent Discord or Escape from Tarkov details.
