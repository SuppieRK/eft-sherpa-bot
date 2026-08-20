## Why

The streamer and volunteer sherpas can operate the live queue, but they cannot see a concise record of the help delivered by the community. Staff need an all-time snapshot that distinguishes submitted, helped, open, and canceled requests and attributes successful work to each raid leader.

## What Changes

- Add a Discord-only `/stats` command for the configured streamer and volunteer-sherpa role in the configured staff channel.
- Return one ephemeral, list-based embed visible only to the caller; do not create a persistent message or add Refresh or Delete controls.
- Show all-time request totals, successful raid totals, and a ranked sherpa list ordered by requests helped with successful raids as the secondary count.
- Attribute a request only to the leader of the raid that successfully completed it, without pinging that leader.
- Add a Discord-only staff `/users` command in the configured staff channel that shows Twitch, Discord, and Escape from Tarkov identity state in an ephemeral ten-user page with stateless Previous and Next controls.
- Let staff select an incomplete directory entry and add its missing Discord member or Escape from Tarkov name; keep `/link-twitch` as the correction command and Twitch stable-ID observation automatic.
- Add migration `0004` to backfill compact statistics rollups and maintain them transactionally from authoritative request, membership, and raid changes.
- Read one summary row and at most ten ranked leader rows so `/stats` cost does not grow with retained history.
- Add both staff read paths to automated command, authorization, correctness, pagination, Discord-limit, and fully local performance coverage.

## Capabilities

### New Capabilities

- `staff-statistics`: Define the all-time metrics, sherpa attribution, list-based ephemeral embed, bounded rendering, and source-of-truth query behavior.
- `staff-user-directory`: Define the staff identity list, registration-state labels, stateless keyset pagination, and controls that add missing Discord or Escape from Tarkov details.

### Modified Capabilities

- `cross-platform-commands`: Add `/stats` and `/users` as Discord-only staff commands and explicitly keep them out of the Twitch public command surface.
- `sherpa-volunteers`: Authorize the configured streamer and current volunteer-sherpa role to view staff statistics and the staff user directory.
- `mvp-deployment`: Register and validate `/stats` and `/users`, apply migration `0004`, and require local D1 performance evidence for the read and rollup-write paths.

## Impact

- Discord guild command configuration and interaction routing.
- Staff authorization, ephemeral embed rendering, and stateless component pagination.
- D1 statistics rollups maintained from help requests, completed memberships, and successful raid groups, plus bounded repository reads over those rollups.
- D1 keyset reads and authorized missing-detail updates over existing Twitch-first user mappings; no new registration or identity table.
- Command-surface, repository, workflow, documentation, and local benchmark tests.
- No Twitch command, public viewer response, persistent Discord message, scheduled task, remote benchmark, arbitrary profile editor, or manual Twitch-ID entry.
