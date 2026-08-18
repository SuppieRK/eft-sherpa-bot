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
12. Start one streamer-led raid.
13. Confirm that the Discord call shows the mode and map.
14. Confirm that the Twitch call shows the mode and map.
15. Record one raid result.
16. Confirm that the raid state changes correctly.

Do not publish the release if one step fails.
