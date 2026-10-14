## Context

The existing database stores two queue kinds with overlapping positive ordering keys. The board reserves three and seven display places and uses a leased, versioned canonical writer. Attempt recording is unused. All product choices are confirmed in the research note.

## Goals / Non-Goals

**Goals:** One raid list, streamer-controlled ordering and reversal, ten-row shared pages, matching viewer positions, a lossless forward migration, and bounded SQL cost.

**Non-Goals:** Pins that survive raid start or whole-raid postponement, a second queue, per-user page sessions, attempt tracking, new dependencies, automatic calls or production deployment.

## Decisions

### Use pin terminology for manual placement

Show **Pinned** on planned raids with manual placement. Name the streamer controls **Pin to top** and **Unpin**, and use pin terminology in confirmations and operator instructions. Pin to top lists only unpinned planned raids; Unpin lists only pinned planned raids. Omit an empty selector and keep both sets of planned raids available to Review. Keep the existing action IDs, manual-order storage, lifecycle, and SQL unchanged. A pin is cleared by raid start or whole-raid postponement.

### Preserve grouping placement and index effective service order

Keep positive `sort_key` for intake and follow-up adjacency. Add one monotonic manual placement value to each raid. Generated effective-order columns put active raids before planned work and pinned planned raids before normal FIFO work, most recent pin first. Index the effective tuple globally and by mode. Retain a separate mode/map/normal-order index for immediate compatible successor lookup, including active or frozen boundaries. Without that index SQLite prefers the mode service index and sorts a complete mode during a pull. Pinning or unpinning changes only the selected planned raid and the existing board dirty state. It does not freeze membership or call anyone. Starting or postponing clears placement in its existing update.

The old mode-head display merge is replaced by one stable global order. Pagination makes every mode reachable without quota sections.

### Use one canonical writer for navigation

Store only the requested page boundary, direction, and ordinal in the existing community singleton. Previous and Next conditionally update this target and dirty version using the rendered revision and canonical message ID. The existing leased drain selects ten rows plus one lookahead using an indexed keyset and hydrates only visible IDs. Each navigation query explicitly seeks within the cursor lane and the adjacent lane, caps each range at eleven IDs, and merges at most twenty-two candidate IDs. LIMIT zero skips unused direction branches. This avoids SQLite scanning a lane when a composite comparison contains scalar cursor subqueries. All data dirty updates reset the target to page one in the same statement. Navigation renders the requested page; a data refresh returns to page one.

Direct navigation PATCH writes were rejected because they can overwrite a newer refresh. Persistent per-user sessions and OFFSET scans add unnecessary state or cost.

### Derive viewer position from current raid placement

Select the caller's earliest current membership by effective service order. Count bounded earlier raids globally and bounded requester totals within that mode, then current preceding members in the selected raid. Preserve the 100-request and 50-raid exactness thresholds. Calculate positions on demand without writing every affected request.

### Retire active attempt and queue-kind contracts

Remove domain queue kinds, split snapshots, attempt counts, unsuccessful outcomes, and ATTEMPT_LIMIT. Preserve helped completion, requester controls, start identity, call statuses, receipt retries, and statistics. Existing compatibility columns remain inert in storage so published migrations and retained historical records stay intact.

### Bound bulk-recovery index writes

New legacy-repair groups remain outside automatic-fill and pull-source indexes while their bounded member batch is inserted. The same D1 transaction enables filling once after memberships and the dirty revision are written. One extra bulk SQL statement avoids per-member index rewrites, with no extra binding call. A unique pass key prevents a competing pass from enabling a previously reviewed group. Any failure rolls back the complete transition. Three worst-case repair passes still use at most 49 statements.

### Move reviewed requesters only to existing destinations

The planned move control uses the next unreviewed, automatically fillable, same-mode/map raid with room in effective service order. Migration 0013 adds a partial mode/map/service-key index containing only eligible destinations. Bounded hydration probes at most one indexed destination per reviewed raid, on its first current member row. The group mapper reuses that result for the remaining members. Normal and active raids skip the lookup. Planned move controls carry the observed destination ID and use a distinct action from active postponement. The owner rejects changed destinations, source states, or review identities and revalidates the first destination and source review inside one transaction, moves only the chosen membership, and closes an emptied source without creating a group. Active requester postponement retains source-linked follow-up creation.

## Risks / Trade-offs

- Shared updates interrupt browsing: this is the confirmed reset-on-every-update policy.
- Valid Markdown expands names: cap the board at ten compact rows and verify worst-case complete payload limits.
- A stale interaction races with a start or refresh: guard the mutation by current state, version, message identity, and existing receipt fencing.
- A simpler query can scan more rows: inspect query plans and run complete local Worker benchmarks, including deep pages and retained history, without raising reviewed ceilings.

## Migration Plan

Add migration 0012. Build a temporary mapping of every open raid ordered by old priority-first FIFO, assign unique positive sparse keys, and normalize open requests and raids into the unified format. Preserve IDs, memberships, capacity, leaders, outcomes, calls, follow-up links, and terminal history. Keep published migration files unchanged. Add bounded lookup indexes and shared navigation metadata. Mark the board dirty so existing controls are replaced without calls or restarts.

Test migration from a populated pre-change database with duplicate old queue keys, both game modes and queues, active and frozen groups, and history. Previous Worker code can read the retained schema, but cannot honor manual placement or pagination; use forward repair after the new behavior is used rather than reverting those semantics.

Add forward migration 0013 for reviewed requester movement. It creates the partial destination index and resets the dirty board to page one. It changes no request, raid, membership, identity, receipt, or statistics record. The previous Worker remains schema-compatible; restoring it would restore automatic follow-up creation during review and the previous component contract. Use a forward repair to retain the accepted behavior. Preserve migration 0012 and all previously recorded checksums. Stage the new Worker, save a fresh recovery bookmark and data snapshot, apply 0013, and activate the staged version.

## Open Questions

None. Exact index and query costs will be verified during implementation.
