# Upstream and deployment verification

This guide is for the maintainer.

The original repository uses a `production` environment that points to maintainer-owned test resources. The streamer fork uses the same workflow and environment names with streamer-owned resources.

## Verify a release candidate

1. Merge the release candidate into upstream `main`.
2. Confirm that CI passes for the exact commit.
3. Run **Deploy production** in `SuppieRK/eft-sherpa-bot`.
4. Approve the upstream `production` environment.
5. Confirm that the deployment evidence contains the same commit SHA.
6. Complete the smoke test below.
7. Run **Publish release**.
8. Enter the semantic version.
9. Confirm that the smoke test is complete.
10. Enter migration, compatibility, operator action, and rollback notes.
11. Run the workflow.

The release workflow rejects a commit that does not have a successful upstream deployment.

## Complete the smoke test

Use only maintainer-owned test accounts and the disposable test D1 database.

1. Run `/request` in Discord.
2. Run `/queue` in Discord.
3. Run `/link-twitch` in Discord.
4. Run `!request [map] [goal]` in Twitch.
5. Run `!queue` in Twitch.
6. Run `/board` in the Discord staff channel.
7. Start one streamer-led raid.
8. Confirm that the Discord call arrives.
9. Confirm that the Twitch call arrives.
10. Record one raid result.
11. Confirm that the raid state changes correctly.

Do not publish the release if one step fails.
