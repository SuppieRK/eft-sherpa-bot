## Context

The review-first workflow lets staff move or remove a requester from the current planned raid, but movement is only downward. A reviewed raid can therefore retain an open requester seat while a later same-mode and same-map raid contains suitable requesters. This occurs naturally after a whole raid is postponed to Priority and can also occur after staff remove or move someone from an Ordinary review.

The current D1 model materializes each party as a raid group and preserves historical membership rows. The existing compatible-raid index excludes full raids, so it cannot efficiently discover every possible pull source. A naïve lookup against 100,000 synthetic planned raids produced a full `raid_groups` scan and temporary order sort. A same-mode and same-map lookup restricted to the existing partial compatible index used an indexed seek, establishing the required key order for a broader planned-source index.

## Goals / Non-Goals

**Goals:**

- Let authorized staff fill one open seat in a reviewed planned raid from the next compatible unreviewed raid.
- Permit one deliberate Ordinary-to-Priority promotion when the destination is a postponed Priority raid.
- Reduce the newly fragmented source party by moving its complete remainder down when one immediate compatible raid can accept it.
- Keep the transition atomic, capacity-safe, mode-safe, bounded, and free of calls or attempt changes.
- Prove the new user-facing paths with fully local D1 row statistics through 100,000 requests.

**Non-Goals:**

- Automatically cascade a vacancy through every later raid.
- Pull from an active, reviewed, or leader-reserved source raid.
- Split the source remainder across several downstream raids.
- Move requesters across game modes or maps.
- Add a public command or change automatic grouping for new requests.

## Decisions

### Show one source in the review message

The planned detail message exposes a `Pull requester up` select menu while requester capacity has an open seat. When the first eligible source exists, the review and post-action render paths put every member of that one source raid directly in the selector. When no source exists, the same control is disabled and states that no compatible requester is available. This matches the existing `Move requester to next raid` interaction, limits the usable selector to one raid's map-bounded membership, and distinguishes unavailable candidates from a missing feature.

An eligible source is planned, unreviewed, automatically fillable, unreserved, later in service order, and has the same game mode and map. An Ordinary destination searches only later Ordinary raids. A Priority destination searches later Priority raids first and then Ordinary raids. Active, reviewed, and leader-reserved groups form boundaries and are not silently modified.

Active raid renders do not perform source discovery. Selector data is advisory and can become stale, so selection still revalidates every boundary atomically. Alternative considered: retain a button that opens a private selector. Staff found the extra step inconsistent with the other requester controls. Alternative considered: select any matching requester in the tail. That weakens stable queue order and requires an unbounded candidate surface.

### Treat deleted planned reviews as dismissed

Re-reviewing a frozen planned raid validates and refreshes its stored Discord detail message before returning a link. A Discord `404` clears the stale message ID with compare-and-set, returns the raid to the board without a details link, and does not create a replacement. A later explicit Review action can open a fresh detail message. Board Refresh uses the same dismissal behavior.

Active raids are different because their detail messages contain the only result and requester controls for an attempt in progress. Refresh continues to recreate a missing active-raid detail with compare-and-set and retains one canonical replacement during concurrent recovery.

### Promote only the selected cross-queue request

When a Priority destination selects an Ordinary source member, the transaction changes only that help request and new membership to Priority. The other source requests remain Ordinary. Any push-down stays within the source's Ordinary queue. An Ordinary destination never pulls a Priority request because Priority is earlier in service order.

This is an explicit staff override, not automatic filling. The reviewed Priority destination remains frozen and does not accept later automatic Ordinary members.

### Attempt one all-or-nothing push-down

After the selected member moves up, the repository examines the source remainder and the immediately following eligible raid in the source queue with the same mode and map. If the complete remainder fits, all remaining source memberships move together into that one raid and the empty source closes as not run. If the remainder is empty, the source closes without a push. If there is no immediate eligible target or the complete remainder does not fit, no remaining source member moves and the source stays planned.

This all-or-nothing rule either removes the fragmented source raid or preserves its party. It never spreads the remainder across several raids and never starts an unbounded cascade. Moved membership history is retained by closing old membership rows and inserting new current rows. The destination and push target store members in stable prior order; the selected pull member is appended to the reviewed destination.

Alternative considered: push as many source members as fit. That can fragment the party further and makes the resulting queue harder to explain. Alternative considered: fill every downstream vacancy automatically. That makes one Discord action proportional to the entire compatible queue and violates scale-independent write goals.

### Commit one capacity-safe transition

Source discovery is advisory. Selection revalidates destination state and vacancy, source identity and membership, queue order, mode, map, review and reservation state, and optional push capacity inside one D1 transaction. Capacity and compatibility triggers remain the final guard. Concurrent or stale actions change nothing and return short refresh guidance.

The transition does not assign a leader, increment an attempt, change call statuses, or notify a requester. After commit, the original reviewed detail message is updated with its new member. The canonical board refreshes in background. Eligible sources and push targets have no retained detail message by definition, so the operation does not create stale secondary controls.

### Add one ordered planned-source index

Add migration `0003` with a partial index on `(is_priority, game_mode, map_id, sort_key)` for planned, automatically fillable, unreserved raids. It supports full and partial source discovery and optional push-target lookup without scanning unrelated maps or modes. No table or stored data changes are required. Previous Workers ignore the additional index, so code rollback remains structurally safe.

### Benchmark both interactions locally

The stable benchmark adds the private source-selector read and a maximum bounded pull with successful push-down at every existing tenfold size through 100,000 requests. The write fixture uses the largest legal membership movement for a standard map and verifies the IceBreaker capacity path separately in repository tests. D1 rows read and written remain the primary evidence; statement and write counts must remain constant across scales.

## Risks / Trade-offs

- [Push-down delays the source remainder into a later raid] → Make it part of the explicit pull result and move the complete remainder only when one immediate compatible party can accept it.
- [An Ordinary requester gains Priority] → Permit promotion only through an explicit staff pull into a Priority destination and update only the selected request.
- [Concurrent review or start makes selector data stale] → Revalidate all groups and capacity atomically; reject without partial movement.
- [A later reviewed or reserved raid would change silently] → Exclude it from automatic push-down and retain the source remainder.
- [A candidate lookup regresses with a skewed queue] → Install the mode-and-map ordered partial index and gate release on local D1 row statistics through 100,000 requests.
- [Candidate discovery adds one indexed read to planned review renders] → Query only the first eligible source and do not run it for active raids.
- [A manually deleted planned detail leaves a stale database link] → Clear the confirmed stale link with compare-and-set and require a later explicit Review to create a fresh message.
- [A deleted active detail removes in-progress controls] → Recreate active details only and retain one canonical replacement during concurrent recovery.

## Migration Plan

1. Apply additive migration `0003` and verify its query plan and checksum locally.
2. Deploy the Worker after the index exists; old Workers remain compatible during the interval.
3. Refresh the canonical board and detail messages to expose the direct selector, dismiss missing planned reviews, and recover missing active details.
4. Smoke-test Ordinary-to-Ordinary pull, Ordinary-to-Priority pull, successful push-down, retained remainder, stale selection, and no-call behavior in DEV.
5. If deployment fails, restore the prior Worker without reverting `0003`; the unused index is safe.

## Open Questions

None. The streamer confirmed that a postponed Priority raid can explicitly pull one selected Ordinary requester; the remaining source party stays in its original queue.
