# Upstream and deployment verification

This guide is for the maintainer.

The original repository uses a `production` environment that points to maintainer-owned test resources. The streamer fork uses the same workflow and environment names with streamer-owned resources.

## Verify a release candidate

1. Merge the release candidate into upstream `main`.
2. Confirm that CI passes for the exact commit.
3. Download the `benchmark-evidence` artifact for the exact commit.
4. Review the D1 rows read and rows written for each operation and size.
5. Compare these row statistics with the prior release report.
6. Explain each material regression before you continue.
7. Run **Deploy production** in `SuppieRK/eft-sherpa-bot`.
8. Approve the upstream `production` environment.
9. Confirm that the deployment evidence contains the same commit SHA.
10. Complete the smoke test below.
11. Run **Publish release**.
12. Enter the semantic version.
13. Confirm that the smoke test is complete.
14. Enter migration, compatibility, performance, operator action, and rollback notes.
15. Run the workflow.

The release workflow rejects a commit that does not have a successful upstream deployment.

Migration `0002` sets all existing requests and raids to PvE. It also keeps old Worker writes compatible during deployment. After the bot accepts PvP Seasonal or PvP data, use a forward repair instead of a version that has no game-mode support.

Migration `0004` backfills compact staff statistics from retained request and raid history. It then maintains the rollups in the same D1 transactions as source changes. After this migration is applied, preserve the source history and use a forward migration to repair a rollup defect.

## Complete the smoke test

Use only maintainer-owned test accounts and the disposable test D1 database.

1. Run `/request` in Discord for PvP Seasonal, PvP, and PvE.
2. Confirm that Discord requires the mode selector.
3. Run `/queue` in Discord.
4. Confirm that the response shows the mode and mode position.
5. Run `/link-twitch` in Discord.
6. Run `!request seasonal [map] [goal]` in Twitch.
7. Run `!request pvp [map] [goal]` in Twitch.
8. Run `!request pve [map] [goal]` in Twitch.
9. Run `!queue` in Twitch.
10. Run `/board` in the Discord staff channel.
11. Confirm that each non-empty mode has a visible raid.
12. Select **Review a raid** for one streamer-led raid.
13. Confirm that the raid stays planned at attempt zero, no leader is assigned, and no requester receives a call.
14. Run `/stats` as the streamer and as a volunteer sherpa. Confirm that each response is visible only to its caller.
15. Run `/users` as the streamer and as a volunteer sherpa. Test the first, middle, and last pages.
16. Add one missing Discord member and one missing Escape from Tarkov name. Use `/link-twitch` for a correction.
17. Run `/stats` and `/users` as a user without a staff role. Confirm that the bot does not show statistics or user details.
18. Select **Call and start raid**.
19. Confirm that the caller becomes the leader.
20. Confirm that the Discord call shows the mode and map.
21. Confirm that the Twitch call shows the mode and map.
22. Record one raid result.
23. Confirm that the raid state changes correctly.

Do not publish the release if one step fails.
