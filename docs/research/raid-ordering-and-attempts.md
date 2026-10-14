# Raid ordering and attempt recording research

The pilot terminology uses **Pinned**, **Pin to top**, and **Unpin** for manual placement. This is a display change. Pins still clear on raid start or whole-raid postponement.

Research date: 2026-10-13.
Status: Research and confirmed product choices. This document does not approve an implementation.

## Requirements from the streamer

- Remove the separate priority queue completely.
- Keep manual control over which raid comes next.
- Improve raid visibility.
- Manual ordering must change actual service order and viewer positions in `!queue` and `/queue`.
- Remove unused raid attempt recording.
- Use **Pin to top** with streamer-only ordering.
- Use **Unpin** to restore normal placement.
- Postpone a whole raid to the end of the unified list.
- Keep automatic filling until staff select **Review a raid**.
- Prefer page controls on the shared Discord board if the design remains simple.
- Selecting **Refresh** must return the board to page one.
- Show at most ten raids per page. Every board data update must reset to page one.
- Minimize SQL interactions alongside KISS and YAGNI. Keep database work bounded.
- Research approaches before implementation. Apply KISS and YAGNI.

## Current behavior and its limits

The staff board reserves three places for priority raids and seven places for ordinary raids.
An empty priority section leaves those three places unused.
Eight ordinary raids therefore produce seven visible raids, although the board can display ten raids in total.
Each section promotes one raid from each non-empty game mode before the remaining FIFO raids.
The board has no navigation. The review selector contains only visible planned raids.
Sources: [board renderer](../../src/infrastructure/discord/staff-board.ts), `renderStaffBoard`; [board specification](../../openspec/specs/raid-run-planning/spec.md), "Requirement: Split canonical board windows" and "Requirement: Manual raid review and start".

Priority is a stored property of both requests and raid groups.
Automatic grouping requires matching priority, game mode, and map.
Whole-raid postponement transfers the raid and its current requests to priority.
It resets the raid to planned, resets calls, and keeps the leader reservation.
The stored open-raid order is unique within each priority value.
Sources: [repository](../../src/infrastructure/cloudflare/d1-mvp-repository.ts), `createRequest` and `postponeRaid`; [baseline migration](../../migrations/0001_mvp_baseline.sql); [membership constraints](../../migrations/0002_add_game_modes.sql).

`getQueueFacts` currently uses two different orders.
It selects the caller's request by priority, then request ID.
It counts the request position by request ID within the selected game mode.
It counts raids ahead from the global mode-presence order of raid groups.
Changing only a raid's `sort_key` would leave the request position and selected next request inconsistent.
Sources: [queue query](../../src/infrastructure/cloudflare/d1-mvp-repository.ts), `getQueueFacts`; [viewer response](../../src/presentation/public-responses.ts), `renderQueueFacts`; [command specification](../../openspec/specs/cross-platform-commands/spec.md), "Requirement: Queue reports personal mode position".

Attempt recording changes more than the visible label.
Starting a raid sets attempt one. An unsuccessful result increments the count.
The attempt limit controls whether the unsuccessful result remains available.
The active renderer offers postponement on every attempt.
The operation guide describes postponement on the last attempt.
Sources: [repository](../../src/infrastructure/cloudflare/d1-mvp-repository.ts), `startRaid` and `recordRaidResult`; [active controls](../../src/infrastructure/discord/staff-board.ts), `activeRaidControls`; [operation guide](../BOT_OPERATION.md).

## Approach comparison

The following tradeoffs are design assessments based on the current flow and Discord constraints.
The streamer has selected **Pin to top**. The other approaches remain research alternatives only.

| Approach | Service order and visibility | Reversal and lifecycle | Complexity and fit |
| --- | --- | --- | --- |
| **Pin to top** | Move a selected planned raid before the other planned raids in one list. Both queue commands use the same order. | A later pin becomes first. **Unpin** removes its manual placement. Clear manual placement when it starts or closes. | Selected approach. One list. No priority section or separate persistent pin state. |
| **Persistent board pin** | Mark a raid in the same list and keep it before unpinned planned raids. It must also change queue positions. | Unpin restores its base place. Clear the pin when the raid starts or closes. | Useful when several raids must stay ahead. Multiple pins require a stable order and more lifecycle rules. A separate pinned section would repeat the visibility problem. |
| **Select next raid** | One selected planned raid appears first and changes viewer positions. Other planned raids keep their order. | Selecting another raid replaces the choice. Clearing the choice restores the base order. | Small model for one immediate choice. It does not express a sequence of several preferred raids. A global choice can conflict with several leaders. |
| **Native Discord message pin** | Save a raid detail message in Discord's Pins window. It does not change stored raid order or viewer positions. | Unpin the message. Deleted or replaced detail messages require reconciliation. | Insufficient by itself. Use only as optional message access if staff request it. |

Discord pins appear in a separate window. Selecting a pin jumps to the message's original channel location.
Discord currently supports 250 pins per channel.
This makes a native pin a message access feature, rather than a service-order control.
Source: [Discord Pin Messages FAQ](https://support.discord.com/hc/en-us/articles/221421867-Pin-Messages-FAQ).

Native pin APIs require `PIN_MESSAGES`.
The current route is `/channels/{channel.id}/messages/pins/{message.id}`.
The older `/channels/{channel.id}/pins/{message.id}` routes are deprecated.
The FAQ contains older `MANAGE_MESSAGES` text that conflicts with its own updated FAQ section.
Use the current API permission contract for engineering decisions.
Sources: [Discord message pin API](https://docs.discord.com/developers/resources/message#pin-message), [Discord permissions](https://docs.discord.com/developers/topics/permissions#permissions-bitwise-permission-flags), [Discord September 2025 patch notes](https://discord.com/blog/discord-patch-notes-september-3-2025).

Streamlabs Cloudbot provides a related streamer workflow.
The broadcaster selects a specific viewer and the bot announces who comes next.
It uses separate Pending and Queued sections.
The manual choice is a useful precedent. Its two-section layout does not solve this streamer's visibility concern.
Source: [Streamlabs Cloudbot queue guide](https://support.streamlabs.com/hc/en-us/articles/4413393973147-How-to-use-Timers-Queue-and-Quotes-in-Streamlabs-Desktop-Cloudbot-101).

## Selected ordering approach

Use one raid list and one **Pin to top** action for planned raids.
The action changes service order. It does not start a raid, assign a leader, freeze membership, or send a call.
Keep active raids visible with their leaders and status.
Moving a planned raid must not interrupt an active raid or change its leader.
Several active raids can exist. A top position expresses the next planned choice, not a claim that all leaders must stop.

Use one shared definition of service order for the board and both queue commands.
An explicit pin must take precedence over the current mode-presence merge.
Otherwise, moving a raid from one mode can leave it behind the first raid from another mode.
Apply mode visibility rules to the remaining raids only if that behavior remains desired.
Historical source: `src/domain/mode-presence-order.ts`, `orderByModePresence`. Implementation removes this unused merge.

For a caller with several requests, select the earliest request under the resulting service order.
For the mode-scoped request position, count current memberships in preceding raids of that mode, then preceding members of the selected raid.
Preserve the member order inside each raid.
For raids ahead, use the same service order across modes.
Keep the existing bounded response limits unless the product requirement changes them.
This preserves the difference between a personal position within one mode and raids ahead across modes.
Sources: [queue facts](../../src/domain/queue-queries.ts), [command specification](../../openspec/specs/cross-platform-commands/spec.md).

Example: planned raids initially appear as `A, B, C`.
After the streamer pins `C`, they appear as `C, A, B`.
After the streamer pins `B`, they appear as `B, C, A`.
The affected viewers receive updated positions on their next queue query.
The same actions do not change raid membership or send notifications.
Proposed lifecycle: clear a manual placement when the raid starts or closes.
Postponement does not automatically restore a manual placement.

Confirmed authority: only the configured streamer changes order.
Existing staff access also includes volunteer sherpas.
Do not assume that access to review and lead a raid also grants authority to change the streamer's order.
Volunteers retain their existing review and raid controls, without ordering authority.
Source: [staff access](../../src/domain/staff-board.ts), `isStaffBoardMember`.

### Shared board pages

Page controls are viable in the existing Discord message format.
Use one combined list, a page indicator, and **Previous**, **Next**, and **Refresh** buttons.
Only the streamer can navigate pages or change raid order.
All staff can see the current shared page.
Keep the raid review and ordering selectors limited to raids on that page.
This makes raids beyond the first page reachable without a second queue.

Shared message components have one payload. They have no actor-specific visibility setting.
Volunteers therefore see the page and ordering controls.
The handler must reject an unauthorized selection with a private response.
This follows from the documented message component and interaction structures.
Sources: [Discord components](https://docs.discord.com/developers/components/reference#button), [Discord interactions](https://docs.discord.com/developers/interactions/receiving-and-responding#interaction-object).

A private picker is an alternative if independent staff views become necessary.
It would avoid shared page changes, but it would add a second navigation surface.
The current preference is shared board pages.
The existing specification prohibits board navigation and page state.
Implementing shared pages therefore requires an explicit specification change.
Source: [board specification](../../openspec/specs/raid-run-planning/spec.md), "Requirement: Split canonical board windows".

#### Page size calculation

Discord's field-count limit does not establish a safe raid count.
The full message must also fit the combined embed text limit.
Use the current compact board row with the attempt text removed for this calculation.
Keep goals and notes in the raid detail message.

The accepted Twitch login limit is 25 characters. A login can contain underscores.
Markdown escaping changes 25 underscores to 50 characters.
Each requester tag therefore needs at most 51 characters, including `@`.
Four requester tags and three ` · ` separators need `4 × 51 + 3 × 3 = 213` characters.
Sources: [login validation](../../src/domain/user-identity.ts), [board row and escaping](../../src/infrastructure/discord/staff-board.ts), [capacity constraints](../../migrations/0001_mvp_baseline.sql).

The longest current mode and map label is `PvP Seasonal · Streets of Tarkov`, with 31 characters.
Reserve 20 digits for a global raid ordinal and 20 digits for each Discord ID.
The raid field name needs at most 54 characters.
The reserved-leader mention needs 40 characters.
The detail URL needs 91 characters. Its complete Markdown link and separator need 110 characters.
Sources: [mode labels](../../src/domain/game-mode.ts), [map labels](../../src/domain/maps/catalog.ts), [board row](../../src/infrastructure/discord/staff-board.ts), `boardRaidField`.

The field value is `Requesters: {tags}\nPlanned · Reserved leader: <@{id}>{details link}`.
Its bound is `12 + 213 + 1 + 7 + 3 + 40 + 110 = 386` characters.
The field name and value therefore need at most `54 + 386 = 440` characters per raid.
The bound includes every requester and the full detail link.
It uses current accepted data and labels. Longer future labels require a new calculation.

Reserve 200 characters for the embed title, page description, and footer.
Reserve a further ten characters per raid for a short manual-placement marker.
The second budget column includes that marker.

| Raids per page | Header plus compact rows | Header plus rows and marker | Assessment against 6,000 characters |
| --- | --- | --- | --- |
| 10 | 4,600 | 4,700 | Selected. Substantial margin and a shorter page to scan. |
| 12 | 5,480 | 5,600 | Viable denser alternative under the stated label and header bounds. Not selected. |
| 15 | 6,800 | 6,950 | Exceeds the limit for valid maximum-length data. |
| 20 | 9,000 | 9,200 | Exceeds the limit. |
| 25 | 11,200 | 11,450 | Exceeds the limit despite meeting the field-count limit. |

Thirteen raids need 5,920 characters before the marker and 6,050 after it.
That leaves inadequate margin for this design.
Even unescaped 25-character logins can make 20 rows exceed 6,000 characters when full leader and detail links are present.
Ten rows give the most margin and the shortest page to scan.
Twelve rows fit the stated bounds, but leave less spare space.
The streamer selected ten raids per page to leave more room for displayed names and message content.
Fifteen rows would need shorter content, truncation, or an adaptive page size.
Those choices add complexity or reduce visibility. They are not the recommended first change.

This calculation excludes component labels from the embed budget, as Discord does.
All raid fields remain below their individual name and value limits.
Keep a final rendered-size check because the calculation assumes accepted input bounds.
Source: [Discord embed limits](https://docs.discord.com/developers/resources/message#embed-limits).

#### Page reset and synchronization

Confirmed behavior: every board data update returns to page one.
This includes **Refresh**, **Pin to top**, **Unpin**, new requests, membership changes, and raid completion.
The streamer selected this policy because it is simpler.
New activity can interrupt browsing. That tradeoff is accepted.

**Previous** and **Next** select the requested page. Rendering a navigation response is not a data refresh.
An empty list uses page one. Disable navigation when no previous or next page exists.

Navigation must respect the existing canonical-board version and lease flow.
A stale navigation response must not restore an old page after a newer data update.
Compare bounded cursor navigation with persistent page state before selecting a storage design.
The page-one reset policy removes the need to preserve a page through data updates.
Avoid adding SQL reads or writes solely to retain that discarded state.
Navigation must remain bounded and must not load every raid before rendering one page.
Keep displayed numbering consistent with service order.
Sources: [snapshot and dirty versions](../../src/infrastructure/cloudflare/d1-mvp-repository.ts), `getBoardSnapshot` and `boardDirtyStatement`; [canonical drain](../../src/infrastructure/discord/raid-messages.ts); [board synchronization specification](../../openspec/specs/raid-run-planning/spec.md).

One possible control layout uses four action rows.
Use one row for the three navigation buttons, then one select each for review, pinning, and unpinning.
Each selector needs at most the number of raids on the page.
Ten or twelve raids therefore fit both the row and select-option limits.
This layout remains a proposal. It does not require Components V2 or per-raid buttons.
Source: [Discord component limits](https://docs.discord.com/developers/components/reference#legacy-message-component-behavior).

Do not add drag-and-drop ordering, numeric priority levels, automatic aging, or a second board section for this request.
Pins that survive raid start or whole-raid postponement are excluded from the selected approach.

### Grouping, fairness, and undo

Manual raid ordering must preserve game-mode compatibility, map compatibility, and requester capacity.
Keep each raid's members together unless staff use the existing requester controls.
Do not reinterpret **Pull requester up** as raid ordering. It changes membership.

Automatic intake currently fills the earliest compatible raid by `sort_key`.
Follow-up creation and pull push-down also use stored order to identify neighboring raids.
A service-order change must not silently change these grouping rules.
Separate stable grouping placement from manual service placement only if preserving current grouping requires it.
Keep automatic filling until staff select **Review a raid**.
Moving a raid or removing its manual placement must not freeze its membership.
The storage design must preserve that behavior and the existing review freeze.
Source: [repository](../../src/infrastructure/cloudflare/d1-mvp-repository.ts), request creation, follow-up planning, and pull planning.

Repeated pins can delay other viewers. Show the actual order and keep waiting timestamps available.
Do not add an automatic fairness policy without a current requirement.
The streamer retains manual discretion.

Use **Unpin** as the confirmed reversal action.
It removes the selected raid's current manual placement and retains its stable base place.
It does not restore an entire old board snapshot or a historical slot.
If another pin changed that placement, reject a stale reversal and show the current order.
If the raid started or closed, reject reversal.
Exact undo would require prior-placement state and stronger concurrency rules.
Do not add undo history unless the streamer needs exact reversal.

## Remove unused attempt recording

Recommended future lifecycle: review, call and start, then continue until **Helped** or an explicit postponement.
Unsuccessful in-game runs require no bot interaction.
Retain completion, requester removal, requester postponement, and pull controls.
These controls change real requests and raid membership.

Remove the attempt count from the board and detail messages.
Remove **Record unsuccessful attempt**, the increment transition, and the attempt-limit policy.
Do not replace them with another counter, timer, or result questionnaire.
The user has established that recording attempts is unused.

Attempt removal also reaches environment validation, generated Worker bindings, deployment configuration checks, and installer documentation.
This requires a focused contract update if implementation is later approved.
Sources: [community configuration](../../src/config/community.ts), [Worker bindings](../../src/worker-configuration.d.ts), [installer documentation](../INSTALLER_SETUP.md), [deployment configuration workflow](../../.github/workflows/check-production-configuration.yml).

Retain raid start identity, call status, and terminal outcomes.
Statistics count requests, helped raids, and leader credit. They do not count unsuccessful attempts.
Removing attempt recording therefore need not remove statistics or historical completion records.
Sources: [statistics model](../../src/domain/staff-statistics.ts), [statistics migration](../../migrations/0004_add_staff_statistics_rollups.sql).

Raid attempts and technical retries are different items.
Retain delivery deduplication, receipt retry counts, leases, board drains, and recovery.
Retain the existing protection against sending a raid call twice.
An ordering action must never resend a call.
Sources: [baseline receipt schema](../../migrations/0001_mvp_baseline.sql), [mutation lifecycle](../../src/infrastructure/discord/mutation-lifecycle.ts), [call and board specification](../../openspec/specs/raid-run-planning/spec.md), [inbound-delivery specification](../../openspec/specs/cross-platform-commands/spec.md).

Confirmed postponement: move the remaining group to the end of the unified list in planned state.
Clear manual placement. Do not recreate priority status.
Preserve the remaining group and require an explicit new start before another call.

## Platform and transition constraints

The existing embed format can remain in use.
Legacy messages permit five action rows. Each row accepts five buttons or one select menu.
A string select accepts at most 25 options.
Source: [Discord component reference](https://docs.discord.com/developers/components/reference#legacy-message-component-behavior).

An embed permits 25 fields. A field value permits 1,024 characters.
All embeds in one message share a 6,000-character budget.
More empty space does not justify an unbounded board.
Source: [Discord embed limits](https://docs.discord.com/developers/resources/message#embed-limits).

Discord requires an initial interaction response within three seconds. Follow-up tokens remain valid for 15 minutes.
Interactions include caller, guild, channel, and source-message metadata.
Use the existing deferred response pattern. Validate authority and current raid state before any order change.
Source: [Discord interaction contract](https://docs.discord.com/developers/interactions/receiving-and-responding).

Proposed transition requirements:

- Validate the configured guild, staff channel, actor, raid, and source message.
- Accept only a current planned raid for **Pin to top**.
- Commit ordering and the board dirty version together.
- Deduplicate exact delivery IDs. A duplicate must not pin the raid again.
- If two pins race, serialize committed placement and report the resulting order.
- Reject stale reversal and start conflicts without changing membership.
- Use the existing board lease so an older Discord update cannot overwrite a newer order.
- Treat Discord display failure as pending synchronization. Keep the committed order for viewer queries.

These requirements reuse existing transition protections.
They do not require a new event store or a generic ordering framework.
Sources: [mutation lifecycle](../../src/infrastructure/discord/mutation-lifecycle.ts), [board synchronization](../../src/infrastructure/discord/raid-messages.ts), [ordering and lease specification](../../openspec/specs/raid-run-planning/spec.md).

## Existing data and rollout

Do not change a published migration. Add a compatible numbered migration when implementation is approved.
Keep existing raid IDs, memberships, leader reservations, outcomes, and call state.
Source: [database contribution rules](../../CONTRIBUTING.md#change-the-database).

The two old queues can contain the same `sort_key`.
Collapsing priority values without remapping order can violate the unique open-order index.
The current key must also remain greater than zero.
Repeated subtraction from the smallest key is therefore not a complete move-to-top strategy.
Membership triggers also require matching request and raid priority values during coexistence.
Sources: [baseline constraints](../../migrations/0001_mvp_baseline.sql), [membership constraints](../../migrations/0002_add_game_modes.sql).

Choose an explicit one-time merge order for existing open raids.
Preserving the former effective service order is a low-surprise proposal.
It does not imply retaining a priority category after migration.
Preserve follow-up relationships and active raids.
Keep historical attempt values inert during compatibility rollout; do not erase completion history.
Remove obsolete fields and indexes only when older Worker versions no longer require them.

Refresh the existing board and detail messages to remove retired attempt and queue controls.
Reject selections from obsolete messages safely.
Do not restart raids or issue calls during migration or message refresh.

## Confirmed product choices

- Use **Pin to top** as the prioritization action. Pins that survive raid start or whole-raid postponement and a separate next-raid selection are excluded.
- Only the configured streamer can change raid order.
- Whole-raid postponement returns the remaining group to planned state at the end of the unified list.
- Ordering changes actual service order and viewer positions in both queue commands.
- Use **Unpin** to remove manual placement and restore normal placement.
- Preserve automatic filling until staff select **Review a raid**.
- Prefer streamer-controlled pages on the shared Discord board.
- Selecting **Refresh** returns the board to page one.
- Show at most ten raids per page, with room for names, links, and message changes.
- Every board data update resets to page one. Page navigation selects the requested page.
- Minimize SQL interactions while following KISS and YAGNI. Preserve bounded database work and concurrency guarantees.

## SQL cost and engineering direction

Minimize binding calls, SQL statements, rows read, and rows written together.
A shorter SQL statement count does not prove lower database cost.
D1 counts scanned rows, including rows that a query does not return.
Writes to indexed columns also write index entries.
Source: [Cloudflare D1 cost definitions](https://developers.cloudflare.com/d1/platform/pricing/#definitions).

`batch()` sends several statements through one binding call.
It reduces database round trips and supplies a transaction for the statements.
It does not reduce the number of statements or the rows that those statements read and write.
Sources: [D1 batch contract](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch), [repository instrumentation](../../src/infrastructure/cloudflare/d1-metrics.ts).

### Paging with minimal coordination state

Compare two engineering options against the confirmed page-one reset policy.

| Option | Database work | Concurrency implications | Assessment |
| --- | --- | --- | --- |
| Button cursor and read-only page query, followed by a direct Discord update | A bounded query can read only the requested page. No saved page is needed for selection. | A navigation update can arrive after a newer data update and leave an old later page visible. A version check after the Discord update does not prevent that race. | Do not use an independent writer for the shared board. Additional lease writes and recovery would still be needed. |
| Small navigation target in existing board state, rendered by the existing leased drain | One guarded state update records the requested cursor and dirty version. The drain reads a bounded page. | Data updates clear the navigation target in the same dirty-state update. All canonical Discord writes retain the existing lease flow. | Recommended direction. Small shared state with no retained page preference across data updates. |

The current lease can start work only when a board version is dirty or its message is missing.
A clean, read-only navigation action therefore cannot use the existing drain without a coordination change.
Keep one canonical writer rather than add a second synchronization mechanism.
Sources: [lease implementation](../../src/infrastructure/cloudflare/d1-mvp-repository.ts), `acquireBoardDrainLease`; [leased rendering](../../src/infrastructure/discord/raid-messages.ts), `synchronizeCanonicalBoard`.

Record the navigation target, expected revision, and dirty version in one conditional state update.
Reject an old navigation revision without changing the state.
Every data update resets that target to page one in the existing dirty-state statement.
That reset requires no separate SQL statement or binding call.
It still participates in the existing row write, lease, and rendering costs.
Do not introduce a page history, a per-user page table, or a separate page-reset job.

Use indexed keyset navigation, not an increasing `OFFSET`.
Select ten raids and at most one extra candidate to determine whether another page exists.
Hydrate only the ten selected raids and their current memberships.
Reuse existing board totals if a total-page label is needed.
Do not count the complete backlog separately on each navigation action.
Candidate limits bound returned records; verify actual indexed reads with the benchmark.
Source: [Cloudflare index guidance](https://developers.cloudflare.com/d1/best-practices/use-indexes/), [current snapshot hydration](../../src/infrastructure/cloudflare/d1-mvp-repository.ts), `getBoardSnapshot`.

The current normal snapshot uses two binding calls and three statements.
It batches board state and candidates, then hydrates the visible IDs.
A fallback count runs only when the board state is missing.
Reuse that read structure or combine it only when the resulting query keeps the work bounded.

Refresh already uses a smaller path than general raid mutations.
It marks the board dirty and schedules leased rendering before the general receipt workflow.
Navigation should not automatically copy the heavier raid receipt workflow.
Use the expected revision and existing lease protections to make repeat navigation safe.
Sources: [Refresh handler](../../src/infrastructure/discord/staff-board-handler.ts), `handle`; [dirty-state implementation](../../src/infrastructure/cloudflare/d1-mvp-repository.ts), `boardDirtyStatement`.

### Manual placement and viewer queries

Prefer one small manual placement value on the selected raid while retaining its normal grouping place.
Moving or removing a manual placement must not renumber every open raid or update every request.
Keep intake and follow-up queries on stable grouping placement.
Use a bounded, indexed effective order for the board and both viewer commands.
Clear manual placement in the existing start or postpone update.
Do not add another write solely to clear it.

Use only indexes required by the accepted lookup paths.
An optional manual placement can support indexed selection of pinned raids and ordinary raids.
The result remains one user-visible list, without a priority category or queue-specific membership rule.
Avoid a computed sort expression that forces a full backlog scan and sort on every page.
Check the query plan and measured D1 row counts before selecting the exact index design.
Source: [Cloudflare partial-index guidance](https://developers.cloudflare.com/d1/best-practices/use-indexes/#partial-indexes).

Reuse the existing monotonic revision where it can supply a safe placement sequence.
Do not add a separate maximum-rank read if one guarded update can obtain that value.
Reject stale placement selections and reuse mutation idempotency protections.
Use a conditional dirty update when no domain row changed.
An already-cleared placement must not trigger another complete board render.
Sources: [conditional dirty writes](../../src/infrastructure/cloudflare/d1-mvp-repository.ts), `boardDirtyStatement`; [mutation lifecycle](../../src/infrastructure/discord/mutation-lifecycle.ts).

Viewer counts must also remain bounded.
An unrestricted count of all earlier raids or requests can read the whole backlog.
Stop the mode-scoped request prefix at the existing 100-request threshold.
Stop the raid prefix at the existing 50-raid threshold.
Use indexed effective-order prefixes and existing current-member counts where appropriate.
Include only the selected raid's preceding members for its internal position.
Do not materialize every viewer's updated position after pinning.
Calculate the current position when the viewer requests it.
Sources: [queue limits](../../src/domain/queue-queries.ts), [current bounded queue query](../../src/infrastructure/cloudflare/d1-mvp-repository.ts), `getQueueFacts`.

### Existing cost evidence and future validation

The following values come from the committed baseline at 100,000 active requests.
They are existing full Worker measurements, including the relevant background work.
They are not measurements of this proposed design or of `getBoardSnapshot` alone.

| Existing operation | Binding calls | Statements | Rows read | Rows written |
| --- | --- | --- | --- | --- |
| `discord.board.refresh` | 7 | 8 | 230 | 3 |
| `discord.board.open` | 4 | 5 | 213 | 0 |
| `discord.queue.p50` | 6 | 8 | 175 | 0 |

Source: [committed exact baseline](../../benchmark/d1-cost-baseline.json).

The reviewed board Refresh family ceiling is ten binding calls, twelve statements, 275 reads, and ten writes.
The reviewed Discord Queue family ceiling is eight calls, twelve statements, 200 reads, and zero writes.
The runner applies stricter operation checks: Refresh permits at most eight statements and 250 reads.
Discord queue queries must read fewer than 200 rows.
Keep the family ceiling and the stricter operation contract distinct.
Sources: [maximum budgets](../../benchmark/d1-maximum-budget.json), [benchmark checks](../../scripts/run-d1-benchmark.mjs).

Implementation validation must use the existing local scales: 100, 1,000, 10,000, and 100,000 active requests.
Measure first, middle, and deep board pages, including pinned raids at the page boundary.
Measure pinning, unpinning, postponement, no-op, exact duplicate, and stale actions.
Include navigation racing with a data update and verify that the final shared board shows page one.
Include retained membership history and concurrent board updates.
Record calls, statements, scanned reads, writes, and relevant query groups for the complete Worker path.

Statements, binding calls, and writes must remain bounded independently of backlog size.
Deep-page reads must not grow in proportion to page number or retained history.
Do not approve higher budgets solely to make a new design pass.
Review any justified baseline change separately from the maximum-budget file.
Sources: [benchmark contract](../../benchmark/contract.ts), [user-facing benchmark](../../benchmark/user-facing.benchmark.ts), [deployment cost requirements](../../openspec/specs/mvp-deployment/spec.md).

No new benchmark was run during this research.
The engineering direction is a proposal that still requires query-plan and local benchmark evidence after implementation is approved.
The product choices above are settled. Implementation remains unapproved.

The confirmed approach uses **Pin to top** with one combined overview and streamer-only ordering.
Remove attempt recording while retaining raid completion and technical recovery.
No code, migration, specification, configuration, or tracker change is approved by this research note.
