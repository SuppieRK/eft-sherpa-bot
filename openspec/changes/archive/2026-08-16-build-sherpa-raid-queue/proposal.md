## Why

The private pilot exposed a regression: requests are not materialized when Twitch has no active or future schedule segment, so the staff board can report no raids even though help requests are waiting. Raid availability, staff controls, and calls must work regardless of published Twitch schedule data.

## What Changes

- Keep the shared public commands limited to Discord `/request` and `/queue` plus Twitch `!request <map> [goal]` and `!queue`.
- Render every Discord slash-command reference in a bot reply as inline code with backticks.
- Materialize every accepted request immediately without reading Twitch schedule state.
- Split durable work into an ordinary queue for new requests and a priority queue for groups that postpone the whole raid.
- Keep stable FIFO order within each queue. Priority work is considered ahead of ordinary work, but the two queues never mix members or fill each other's groups.
- Show one canonical Discord board with up to three priority raids and up to seven ordinary raids. Each section says how many raids it shows without an additional help-request or outstanding-raid counter.
- On `/board` and `Refresh`, validate visible active raid-detail messages in the background. Recreate only messages confirmed deleted, keep active raid state unchanged, and remove stale links from the canonical board until repair succeeds.
- Keep one `Refresh` control and one `Start a raid` selector containing the visible planned raids, with priority raids listed first.
- Start raids at any time. Streamer-led starts send Discord and Twitch calls; volunteer-led starts keep the existing Discord-only call behavior.
- Track a configurable number of attempts, default three. On the final attempt, staff choose `Helped` or `Postpone raid`; postponement reuses the raid, moves it to the end of Priority, and resets attempts.
- Keep individual postponement directly after its source raid in the same queue. Let the leader remove one request permanently or postpone the whole remaining raid to the end of the priority queue.
- Keep the visible leader tag on every active raid-message update without sending another notification, and delete obsolete raid messages when `Helped`, `Postpone raid`, or another action leaves no active raid behind them.
- Remove Twitch Schedule API fetching, storage, cron, internal refresh route, timezone configuration, schedule board text, and automatic segment rollover.
- Replace the disposable baseline with six tables. Store the canonical board message ID in a small `community_state` table instead of schedule or night state.
- Keep the D1 baseline small: derive request references and order from request IDs and store finite states and timestamps as integers. Do not store a Try Again outcome or retry origin.
- Make raid result and postponement transitions atomic. Maintain each raid's current membership count with D1 triggers so compatible-raid reads can use a bounded partial index, and maintain exact two-queue board totals in the existing community singleton. Use split indexed aggregate queue reads, indexed scalar queue maxima, sparse raid ordering, linear bulk waiting-request materialization, and bounded delivery-receipt retention.
- Keep performance claims evidence-based with a reproducible full-Worker benchmark that uses only a fully local seeded D1 database. Measure the supported successful user operations at 100, 1,000, 10,000, and 100,000 active requests and keep machine-readable and human-readable reports.
- Simplify `/queue` and `!queue` to the caller's global priority-first position, map, raids ahead, and other maps. Callers without an active request receive only platform-specific join guidance.
- Keep Queue exact for up to 100 earlier requests and 50 earlier raids. Above either limit, report the corresponding lower bound instead of counting an unbounded prefix.
- Validate each stored raid requester capacity against the committed Tarkov map catalog: four requester places on standard five-person maps and two on three-person Icebreaker, always leaving one place for the sherpa.
- Keep Biome as the only formatter and baseline linter. Add Oxlint with TypeScript-Go for type-aware correctness checks and Knip for unused files, exports, types, and dependencies. Make all three blocking local, CI, and deployment verification gates without adding Gradle, Spotless, ESLint, CodeQL, or Semgrep.
- Incorporate accepted private-pilot findings directly into this proposal, its design, capability specifications, implementation tasks, and operator README. Do not maintain a separate pilot-feedback ledger.
- Record the completed and accepted developer-owned private pilot before archival. Keep streamer-owned deployment and public launch as separate later work.

## Capabilities

### New Capabilities

- `help-request-tickets`: Twitch-native and Discord request intake with bounded text and Twitch-first identity.
- `raid-run-planning`: Unlimited materialized grouping, independent ordinary and priority queues, bounded board windows, claimed raid execution, attempts, and individual postponement.
- `sherpa-volunteers`: Discord-role-based board access and volunteer-led raids.
- `cross-platform-commands`: Shared request and queue words plus Discord-native identity association.
- `schedule-independent-operations`: Raid availability, state, controls, and calls that never depend on Twitch schedule data.
- `fixed-mvp-configuration`: One committed private-pilot configuration with configurable attempt limit and secret-based credentials.
- `mvp-deployment`: Developer-owned private resources and an internal pilot before streamer setup.

## Impact

- Replaces the disposable D1 baseline. No production or real-user data is migrated.
- Keeps six application tables: `event_receipts`, `help_requests`, `user_mappings`, `raid_groups`, `raid_group_members`, and `community_state`.
- Resets the disposable D1 database because the directly revised baseline adds trigger-maintained raid occupancy and replaces the compatible-raid index. The private database contains no real-user data, so no compatibility migration is required.
- Revises that same disposable baseline to reject unknown maps and requester capacities that exceed the map-specific sherpa-party limit.
- Removes schedule polling and one Cloudflare cron while retaining Twitch EventSub, chat replies, calls, and authorization health checks.
- Preserves the existing Discord command surface and canonical board message when its stored message ID can be recovered before reset.
- Keeps benchmark execution fully local: it rejects remote D1 configuration and mocks Discord and Twitch delivery. The verified optimization is deployed separately to the disposable private pilot.
- Removes unreachable adapter modules and unnecessary public exports found during zero-baseline Knip adoption, and fixes the request-construction issues found by Oxlint without changing the bot command surface or D1 schema.
- Completes the internal MVP acceptance gate on 2026-08-16 without authorizing streamer-owned deployment or public launch.
