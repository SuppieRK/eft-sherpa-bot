## Context

The bot has completed manual testing on maintainer-owned Cloudflare, Discord, and Twitch resources. The repository has no remote, its deployment workflow targets an internal-test environment, and its tracked community JSON embeds the pilot's public platform IDs. The streamer is non-technical but can use GitHub's browser interface. The maintainer needs to publish patches without retaining control of the streamer's production accounts.

## Goals / Non-Goals

**Goals:**

- Publish one sanitized MIT-licensed upstream repository with no pilot Git history.
- Let a streamer-owned public fork deploy to streamer-owned infrastructure through protected GitHub environments.
- Prove each release commit through an equivalent upstream deployment before publication.
- Keep fork-specific values outside tracked files so Sync fork remains conflict-free.
- Automate migration, Worker deployment, Discord configuration, EventSub reconciliation, health validation, evidence, and Twitch app-token refresh.
- Give the streamer complete browser-only instructions in ASD-STE100 Simplified Technical English.

**Non-Goals:**

- Multi-tenant hosting from one Worker or database.
- Automatic adoption or deployment of upstream patches.
- Creating Twitch, Discord, Cloudflare, or GitHub accounts through code.
- Automatic D1 restoration after a failed deployment.
- Formal third-party ASD-STE100 certification.

## Decisions

### Use a public upstream and streamer-owned public fork

`SuppieRK/eft-sherpa-bot` is the trusted upstream. The streamer owns a public fork, GitHub production environment, Cloudflare resources, and platform applications. This gives the streamer custody of credentials and permits GitHub's Sync fork workflow. A standalone template copy was rejected because it has no upstream relationship. A shared upstream deployment was rejected because production ownership would remain coupled to the maintainer.

### Use the same production contract in upstream and forks

Both repositories use the same `Deploy production` workflow and an environment named `production`. In the upstream repository, that environment points to maintainer-owned test resources and a disposable D1 database. In the fork, it points to streamer-owned resources. A release workflow verifies that the exact release SHA has a successful upstream deployment and a confirmed manual smoke test. Separate reduced deployment logic was rejected because it would not prove the fork path.

### Load public community values from Worker variables

Platform IDs, Discord public key, and policy integers become Worker environment values rendered from GitHub environment variables. Tests continue to inject a typed `CommunityConfig`. Secrets remain Worker secrets. Keeping a customized tracked JSON in each fork was rejected because upstream synchronization would create conflicts.

### Generate Twitch app tokens during deployment

GitHub stores the Twitch client secret, not an expiring app token. Deployment and the manual refresh workflow request a new app access token, mask it, and upload it as a Worker secret. The one-time bot authorization remains an installer operation because it requires Twitch user consent.

### Target Worker secrets with production configuration

The workflow deploys the configured production Worker and then uploads all Worker secrets with the rendered production Wrangler configuration and explicit Worker name. Secret upload through the Wrangler Action input was rejected after the streamer-fork rehearsal showed that it used the tracked local Wrangler configuration and uploaded secrets to `coffee-bot-local`.

### Wait for Worker readiness before platform configuration

Cloudflare can accept a secret update before the new Worker version is ready at the public route. The deployment and token-refresh workflows use a bounded readiness probe after secret upload. Production deployment configures Discord and Twitch only after health, Twitch authorization, and D1 diagnostics respond successfully.

### Keep migrations forward-compatible

Deployment records a D1 Time Travel bookmark and applies pending migrations before deploying code. After `v0.1.0`, applied migration files are immutable and new migrations remain compatible with the previous Worker version. Automatic D1 rollback is prohibited because it could discard writes received after the bookmark.

### Publish a clean initial history

After source verification, the existing `.git` directory is deleted. The sanitized snapshot becomes one root commit using the maintainer's GitHub noreply address. This intentionally discards private-pilot commits and prevents old public IDs and author email from entering GitHub.

### Treat documentation as an operational interface

README, guides, templates, workflow labels, and release instructions use ASD-STE100 Simplified Technical English. Environment values are grouped by provider and identify the exact dashboard field, local-file key, or command-output field that the installer must copy. Format checks distinguish numeric platform IDs, login names, resource names, URLs, and credentials. Automated checks cover links, the documented production environment contract, and mechanical rules; human review covers vocabulary and meaning. The canonical MIT license is exempt because legal text must remain canonical.

## Risks / Trade-offs

- [A synced upstream workflow can access production secrets after approval] → Keep manual deployment, require environment approval, restrict deployment to `main`, and pin every external Action to a full SHA.
- [Upstream test resources differ from streamer resources] → Use the same workflow, variable names, secret names, scripts, platform validations, and post-deployment checks, then rehearse the first deployment in the actual fork.
- [Twitch app tokens expire] → Generate a token on every deployment and provide a protected manual refresh workflow.
- [A migration makes old code incompatible] → Enforce immutable additive migrations and split destructive changes across releases.
- [GitHub browser labels change] → Link official documentation and keep instructions versioned with releases.
- [Automated prose checks cannot prove STE compliance] → Require manual documentation review before release.

## Migration Plan

1. Implement runtime variables, deployment scripts, workflows, tests, metadata, and public documentation in the current local repository.
2. Verify source, migrations, documentation, and secret exclusions locally.
3. Delete `.git`, initialize the clean repository, and commit the sanitized snapshot.
4. Create the public upstream and configure its `production` environment with existing personal test resources.
5. Deploy the exact initial commit from the upstream repository and complete the platform smoke test.
6. Run the gated release workflow to create `v0.1.0`.
7. Guide the streamer through fork creation, environment setup, and first deployment.

Rollback uses the previous Cloudflare Worker version. D1 restoration remains an explicit operator action based on the recorded Time Travel bookmark.

## Open Questions

None.
