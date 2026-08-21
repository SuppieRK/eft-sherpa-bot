# Profile Worker CPU Use

Use this procedure to compare Worker CPU use before and after a code change. It uses local workerd. It does not use a Cloudflare account, a remote D1 database, or real platform credentials.

1. Run `npm run profile:worker`.
2. Wait for Wrangler to start.
3. Press `D` in the Wrangler terminal.
4. Select **Profiler** in DevTools.
5. Select **Start**.
6. In a second terminal, run `npm run profile:replay`.
7. Select **Stop** in DevTools.
8. Save the profile under `.artifacts/worker-profile` if you need it for local comparison.

The replay command sends 500 signed Twitch verification requests and 500 signed Discord ping requests. The setup command generates temporary signing values under `.artifacts`. Do not copy these temporary values to GitHub settings or a deployed Worker.

Repeat the same procedure on both revisions. Compare the signature-verification functions and cryptographic key imports. Record a short result in the pull request. Do not use local wall time as a deployment limit. Do not commit the generated keys or CPU profile.
