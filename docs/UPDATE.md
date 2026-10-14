# Update the bot

The maintainer will tell you when a verified release is ready. Do not sync an update that does not have a GitHub release.

1. Open your `eft-sherpa-bot` fork.
2. Select **Sync fork**.
3. Review the upstream changes.
4. Select **Update branch**.
5. Open the **Actions** tab.
6. Wait for **CI** to pass on `main`.
7. Select **Deploy production**.
8. Select **Run workflow**.
9. Select the `main` branch.
10. Select **Run workflow** again.
11. Wait for **Verify selected commit** to pass.
12. Select **Review deployments**.
13. Select `production`.
14. Select **Approve and deploy**.
15. Confirm that the deployment summary shows Discord, Twitch, and Worker health as `ready`.

If deployment fails, do not run it repeatedly. Give the workflow URL to the technical installer.

## Refresh the Twitch token

Use this procedure when the operator status reports an invalid Twitch token.

1. Open the **Actions** tab.
2. Select **Refresh Twitch token**.
3. Select **Run workflow**.
4. Select **Review deployments**.
5. Select `production`.
6. Select **Approve and deploy**.
7. Confirm that **Wait for Worker readiness** is green.

This workflow does not change bot code or the D1 schema.


## Unified raid order

Migration `0012` keeps live requests, raid IDs, membership, leaders, calls, and history. It merges open raids in their previous priority-first FIFO order and assigns unique normal positions. Active raids remain active and appear first. The migration does not call or restart a raid.

The retained legacy columns preserve historical data. Current code does not use queue categories or raid attempt counts. A board refresh replaces the old controls. Refresh also returns the shared board to page one.

WARNING: Do not restore split-queue Worker code after this update. Use a verified forward fix. Do not reset D1 or edit a published migration.
