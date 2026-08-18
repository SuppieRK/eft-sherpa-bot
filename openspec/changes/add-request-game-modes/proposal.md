## Why

Escape from Tarkov help requests now span PvP Seasonal, PvP, and PvE, but the bot cannot record or distinguish those modes. Without a required mode, it can group players who cannot join the same raid and can let one mode occupy every visible board slot while other modes wait unseen.

## What Changes

- **BREAKING** Require every Discord and Twitch request to select a game mode.
- Accept Twitch mode tokens `pvp-seasonal`, `pvp seasonal`, `seasonal`, `pvp`, and `pve` in `!request [mode] [map] [goal]`.
- Add a required Discord `/request` mode choice before the existing five-field request modal opens.
- Persist game mode on help requests and raid groups and allow one active request per Twitch login, mode, and map.
- Group requests only when queue kind, game mode, and map match, including requester-postponement follow-ups.
- Reserve at least one visible raid for each non-empty mode in each Priority and Ordinary board section, then fill remaining slots by FIFO order.
- Report mode-scoped request position and calculate raids ahead from the same mode-presence ordering used by the board.
- Show mode on the board, raid details, request confirmations, queue replies, and Discord and Twitch raid calls.
- Add migration `0002`, backfill all existing requests and raids as PvE, and deploy the feature as one forward-compatible release.
- Block release until the fully local mixed-mode benchmark produces updated latency and D1 rows-read and rows-written evidence for every user-facing operation through 100,000 seeded requests.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cross-platform-commands`: Require mode-aware request syntax and make Queue describe mode-scoped position and mode-fair raids ahead.
- `help-request-tickets`: Validate and persist game mode and change active-request uniqueness to Twitch login, mode, and map.
- `raid-run-planning`: Make grouping, follow-ups, board ordering, raid displays, and calls mode-aware.
- `mvp-deployment`: Apply additive migration `0002` and backfill pre-mode production data as PvE.

## Impact

The change affects the Discord command contract and modal state, Twitch text parsing, help-request validation, D1 schema and indexes, repository grouping and queue queries, staff-board rendering, raid-call text, local benchmark fixtures, deployment migration evidence, public documentation, and unit and integration tests. It adds no external service or runtime dependency.
