# Installer setup

This guide is for the technical installer. The streamer must own all production accounts and applications.

## Prepare the accounts

Prepare these items:

- a streamer-owned [GitHub account](https://docs.github.com/en/get-started/start-your-journey/creating-an-account-on-github);
- a streamer-owned [Cloudflare account](https://developers.cloudflare.com/fundamentals/account/create-account/);
- a Twitch owner account with two-factor authentication;
- a separate Twitch bot account;
- a streamer-owned Discord application.

Use the [Twitch Developer Console](https://dev.twitch.tv/console/apps) to create the Twitch application. Use the [Discord Developer Portal](https://discord.com/developers/applications) to create the Discord application.

## Prepare Cloudflare

1. Sign in to the streamer-owned Cloudflare account.
2. Open **Workers & Pages**.
3. Select **Create application**.
4. Select a basic Worker template. Do not connect a Git repository.
5. Enter `eft-sherpa-bot` as the Worker name.
6. Deploy the template.
7. Record the `workers.dev` HTTPS URL.
8. Create a D1 database named `eft-sherpa-bot`.
9. Record the account ID and D1 database ID.
10. Create a custom API token for the streamer account.
11. Give the token `Workers Scripts:Write` and `D1:Edit`.
12. Do not put the token in a repository file.
13. Open the GitHub repository that will deploy the bot.
14. Select **Settings**.
15. Select **Environments**.
16. Select `production`.
17. Under **Environment secrets**, select **Add environment secret**.
18. Enter `CLOUDFLARE_API_TOKEN` in **Name**.
19. Paste the token in **Value**.
20. Select **Add secret**.

The first GitHub deployment replaces the template Worker. GitHub Actions controls later deployments.

## Prepare Twitch

1. Create the Twitch application with the streamer owner account.
2. Record the client ID and client secret.
3. Put the client ID, client secret, bot login, and broadcaster login in `.dev.vars.operator`.
4. Run `npm run twitch:authorize` on the installer computer.
5. Open the URL that the command shows.
6. Sign in with the Twitch bot account.
7. Approve the requested scopes.
8. Ask the streamer to make the bot account a moderator.
9. Record the broadcaster user ID and bot user ID from the command output.

The user approval is a one-time action. GitHub creates a new application token during each deployment.

## Prepare Discord

1. Create the Discord application with the streamer owner account.
2. Keep only **Guild Install** on the **Installation** page.
3. Set **Install Link** to **None**.
4. Install the application in the streamer server.
5. Create one request channel.
6. Create one staff channel.
7. Create one volunteer sherpa role.
8. Give the bot **View Channel**, **Send Messages**, and **Embed Links** in both channels.
9. Record all Discord values in the table below.

## Add GitHub environment variables

Use the streamer fork for the streamer deployment. Use
[SuppieRK/eft-sherpa-bot](https://github.com/SuppieRK/eft-sherpa-bot) only for the maintainer test
deployment.

1. Open the repository that will deploy the bot.
2. Select **Settings**.
3. Select **Environments**.
4. Select `production`.
5. Under **Environment variables**, select **Add environment variable**.
6. Enter the table name in **Name**.
7. Enter the source value in **Value**.
8. Select **Add variable**.
9. Repeat these steps for each table row.

| Name | Source | Public | GitHub location | Validation |
|---|---|---:|---|---|
| `COMMUNITY_ID` | Use `butcoffee` | Yes | Environment variable | Configuration check |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account overview | Yes | Environment variable | Wrangler authentication |
| `D1_DATABASE_ID` | Cloudflare D1 database page | Yes | Environment variable | Wrangler configuration |
| `D1_DATABASE_NAME` | Use `eft-sherpa-bot` | Yes | Environment variable | D1 migration step |
| `WORKER_NAME` | Use `eft-sherpa-bot` | Yes | Environment variable | Worker deployment |
| `WORKER_BASE_URL` | Worker `workers.dev` HTTPS URL | Yes | Environment variable | Health check |
| `TWITCH_BROADCASTER_USER_ID` | Twitch authorization output | Yes | Environment variable | Twitch validation |
| `TWITCH_BOT_USER_ID` | Twitch authorization output | Yes | Environment variable | Twitch validation |
| `TWITCH_CLIENT_ID` | Twitch Developer Console | Yes | Environment variable | Twitch token request |
| `DISCORD_APPLICATION_ID` | Discord **General Information** | Yes | Environment variable | Discord validation |
| `DISCORD_PUBLIC_KEY` | Discord **General Information** | Yes | Environment variable | Discord signature check |
| `DISCORD_GUILD_ID` | Discord **Copy Server ID** | Yes | Environment variable | Discord validation |
| `DISCORD_REQUEST_CHANNEL_ID` | Discord **Copy Channel ID** | Yes | Environment variable | Discord validation |
| `DISCORD_STAFF_CHANNEL_ID` | Discord **Copy Channel ID** | Yes | Environment variable | Discord validation |
| `DISCORD_VOLUNTEER_ROLE_ID` | Discord **Copy Role ID** | Yes | Environment variable | Discord validation |
| `DISCORD_STREAMER_USER_ID` | Discord **Copy User ID** | Yes | Environment variable | Discord validation |
| `RECIPIENT_LIMIT` | Use `4` | Yes | Environment variable | Configuration check |
| `ATTEMPT_LIMIT` | Use `3` | Yes | Environment variable | Configuration check |

## Add GitHub environment secrets

Use the same repository and its `production` environment. Do not use repository-level secrets.

1. Open **Settings** and select **Environments**.
2. Select `production`.
3. Under **Environment secrets**, select **Add environment secret**.
4. Enter the table name in **Name**.
5. Enter the source value in **Value**.
6. Select **Add secret**.
7. Repeat these steps for each table row.

Do not show these values in a screenshot or message. Do not put these values in repository files.

| Name | Source | Public | GitHub location | Validation |
|---|---|---:|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare custom API token | No | Environment secret | Wrangler authentication |
| `DISCORD_BOT_TOKEN` | Discord **Bot** page | No | Environment secret | Discord validation |
| `TWITCH_CLIENT_SECRET` | Twitch Developer Console | No | Environment secret | Twitch token request |
| `TWITCH_EVENTSUB_SECRET` | A random value with at least 32 bytes | No | Environment secret | EventSub callback verification |
| `SPIKE_DIAGNOSTICS_TOKEN` | A different random value with at least 32 bytes | No | Environment secret | Operator status check |

The legacy word `SPIKE` remains in one secret name. It does not enable a spike command.

## Complete the first deployment

Use [Streamer setup](STREAMER_SETUP.md) to run the configuration check and deployment. Then use [Upstream and deployment verification](UPSTREAM_RELEASE.md) for the smoke test.
