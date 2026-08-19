## Context

The canonical Discord board displays at most three Priority raids and seven Ordinary raids. Each raid heading currently renders `mode · map (occupied/party capacity)`, where occupied adds one implicit leader seat to the actual requester count. Before a planned raid starts, that leader is not assigned, so staff can read `2/5` as two requesters when only one requester exists.

The board already receives every current member's Twitch login and exposes those logins in the review selector. Twitch logins are limited to 25 characters, and a raid has at most four requesters, so displaying the same identities in each of the ten bounded raid fields remains comfortably within Discord's 6,000-character aggregate embed limit.

## Goals / Non-Goals

**Goals:**

- Make the number and identity of current requesters unambiguous at a glance.
- Preserve the compact, bounded board and its progressive-disclosure model.
- Render all requester identities safely as text without creating Discord mentions.

**Non-Goals:**

- Change automatic grouping, requester capacity, leader reservation, or raid state.
- Add objectives, notes, EFT names, Discord identities, or capacity explanations to the board.
- Change the detailed raid message or the review selector.

## Decisions

### Put requesters on a separate summary line

Each raid field keeps `index. mode · map` as its heading and begins its value with `Requesters: @login · @login`. The existing state, attempt, leader, and detail-link line follows it. This is easier to scan than placing a variable-length participant list in the heading and leaves the map identity visually stable.

Alternative considered: replace only `(2/5)` inline with one or more names. That removes the misleading count but makes long multi-requester headings harder to compare.

### Remove capacity from the canonical board

The board will not replace the fraction with another count. The visible Twitch identities already reveal the requester count, while requester capacity is not needed to choose which raid to review. Full party context remains available in the raid-specific message.

Alternative considered: show `1 requester · 4 party slots`. This is accurate but adds terminology and still requires staff to distinguish requester seats from the leader seat.

### Reuse bounded current membership data

Rendering will use the `members` already loaded for each visible raid. It requires no additional D1 query, schema migration, external API call, or unbounded data access. Twitch logins will be Markdown-escaped before insertion into embed text. Discord allowed mentions remain disabled.

## Risks / Trade-offs

- [Four long Twitch logins add board text] → The existing ten-raid and four-requester bounds keep the additional text well below Discord's aggregate embed limit; add a maximum-shape regression test.
- [Requester names make the board denser] → Keep goals, notes, EFT names, and Discord identities exclusively in raid details.
- [Twitch logins use normalized case] → Treat the stored login as the stable cross-platform identity, consistent with the existing selector and calls.

## Migration Plan

Deploy the Worker without a database migration, refresh the canonical board to replace the rendered fields and controls, and verify one single-requester and one grouped raid in DEV. Rollback requires only restoring the previous Worker version.

## Open Questions

None.
