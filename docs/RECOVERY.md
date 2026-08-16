# Recover a deployment

## Restore Worker code

Use this procedure when a new Worker version fails but D1 remains healthy.

1. Sign in to Cloudflare.
2. Open **Workers & Pages**.
3. Open the `eft-sherpa-bot` Worker.
4. Open **Deployments**.
5. Find the last verified version.
6. Select its menu.
7. Select **Rollback**.
8. Confirm the rollback.
9. Check the Worker health URL.
10. Run `/queue` and `!queue` with test accounts.

## Restore D1 data

WARNING: A D1 restore overwrites the live database. It can remove requests that arrived after the selected bookmark. Stop and identify the correct bookmark before you continue.

The deployment evidence contains a D1 Time Travel bookmark. The technical installer must compare that bookmark with the deployment time and current queue activity.

Run this command only after the streamer approves the data loss:

```text
npx wrangler d1 time-travel restore eft-sherpa-bot --bookmark=<BOOKMARK>
```

After the restore, deploy the compatible Worker version. Then check Discord, Twitch, and the queue.

Cloudflare has more information in [D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).
