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
9. Select the database and record its **Database ID**.
10. Open **Workers & Pages** and record the **Account ID** in **Account Details**.
11. Create a custom API token for the streamer account.
12. Give the token `Workers Scripts:Write` and `D1:Edit`.
13. Copy the token value when Cloudflare shows it.
14. Do not put the token in a repository file.

The first GitHub deployment replaces the template Worker. GitHub Actions controls later deployments.

Use the official Cloudflare instructions to [find the account ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/), [create the D1 database](https://developers.cloudflare.com/d1/get-started/), and [create the API token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).

## Prepare Twitch

1. Create the Twitch application with the streamer owner account.
2. Record the client ID and client secret.
3. Put the client ID, client secret, bot login, and broadcaster login in `.dev.vars.operator`.
4. Run `npm run twitch:authorize` on the installer computer.
5. Open the URL that the command shows.
6. Sign in with the Twitch bot account.
7. Approve the requested scopes.
8. Ask the streamer to make the bot account a moderator.
9. Keep the Twitch IDs that the command adds to `.dev.vars.operator`.
10. Keep `.dev.vars` and `.dev.vars.operator` on the installer computer.

The user approval is a one-time action. GitHub creates a new application token during each deployment.

The [Twitch application guide](https://dev.twitch.tv/docs/authentication/register-app/) explains the client ID and client secret. A new client secret invalidates the previous client secret.

## Prepare Discord

Warning: **Reset Token** invalidates the previous Discord bot token. If you reset the token, replace every stored copy.

1. Create the Discord application with the streamer owner account.
2. Record **Application ID** and **Public Key** from **General Information**.
3. Open **Bot** and record the bot token. If Discord does not show a token, select **Reset Token** and record the new value.
4. Keep only **Guild Install** on the **Installation** page.
5. Set **Install Link** to **None**.
6. Install the application in the streamer server.
7. In Discord, open **User Settings**, then **Advanced**, and enable **Developer Mode**.
8. Create one request channel.
9. Create one staff channel.
10. Create one volunteer sherpa role.
11. Give the bot **View Channel**, **Send Messages**, and **Embed Links** in both channels.
12. Confirm that the bot can view both channels before you record their IDs.

The [Discord Developer Mode guide](https://support.discord.com/hc/en-us/articles/206346498) explains how to copy server, channel, role, and user IDs.

## Add GitHub environment values

Use the streamer fork for the streamer deployment. Use
[SuppieRK/eft-sherpa-bot](https://github.com/SuppieRK/eft-sherpa-bot) only for the maintainer test
deployment.

Each table has these columns:

- **GitHub type** tells you to use **Environment variables** or **Environment secrets**.
- **Enter this value** identifies the exact value to paste.
- **Get it here** gives the exact page, control, file key, or command-output field.
- **Format/check** identifies the expected format and a common incorrect value.

Do not add quotation marks, labels, or spaces around a value. A numeric Twitch or Discord ID is not a login name, display name, or mention.

1. Open the repository that will deploy the bot.
2. Select **Settings**.
3. Select **Environments**.
4. Select `production`.
5. For a `Variable` row, select **Add environment variable** under **Environment variables**.
6. For a `Secret` row, select **Add environment secret** under **Environment secrets**.
7. Enter the table value from **Name** in the GitHub **Name** field.
8. Enter the table value from **Enter this value** in the GitHub **Value** field.
9. Save the value.
10. Repeat these steps for each table row.

Do not use repository-level variables or secrets. Do not show a secret in a screenshot or message. Do not put a secret in a tracked file.

### Cloudflare values

| Name | GitHub type | Enter this value | Get it here | Format/check |
|---|---|---|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | `Variable` | The value labeled **Account ID** | Cloudflare dashboard: **Workers & Pages** → **Account Details** | Exactly 32 hexadecimal characters; do not use the account name |
| `D1_DATABASE_ID` | `Variable` | The value labeled **Database ID** for `eft-sherpa-bot` | Cloudflare dashboard: **D1 SQL database** → `eft-sherpa-bot` | UUID with hyphens; do not use the database name |
| `D1_DATABASE_NAME` | `Variable` | `eft-sherpa-bot` | Use this exact fixed value | Must match the D1 database name |
| `WORKER_NAME` | `Variable` | `eft-sherpa-bot` | Use this exact fixed value | Must match the placeholder Worker name |
| `WORKER_BASE_URL` | `Variable` | The complete public URL of the placeholder Worker | Cloudflare dashboard: **Workers & Pages** → `eft-sherpa-bot` → public route | Starts with `https://` and ends with `.workers.dev`; do not add a path |
| `CLOUDFLARE_API_TOKEN` | `Secret` | The token value that Cloudflare showed after creation | Cloudflare custom API token result page | Use the token value; do not use the token name or token ID |

### Twitch values

Run `npm run twitch:authorize` before you add these values. The command creates or updates the ignored files `.dev.vars` and `.dev.vars.operator`.

| Name | GitHub type | Enter this value | Get it here | Format/check |
|---|---|---|---|---|
| `TWITCH_BROADCASTER_USER_ID` | `Variable` | The value after `TWITCH_BROADCASTER_USER_ID=` | `.dev.vars.operator` on the installer computer | Digits only; do not use the broadcaster login |
| `TWITCH_BOT_USER_ID` | `Variable` | The value after `TWITCH_BOT_USER_ID=` | `.dev.vars.operator` on the installer computer | Digits only; do not use the bot login |
| `TWITCH_CLIENT_ID` | `Variable` | The value after `TWITCH_CLIENT_ID=` | `.dev.vars.operator` on the installer computer | Letters and digits; do not use a user ID |
| `TWITCH_CLIENT_SECRET` | `Secret` | The value after `TWITCH_CLIENT_SECRET=` | `.dev.vars.operator` on the installer computer | Use the application client secret; do not use an access token or refresh token |
| `TWITCH_EVENTSUB_SECRET` | `Secret` | The value after `TWITCH_EVENTSUB_SECRET=` | `.dev.vars` on the installer computer | The authorization command generates 64 hexadecimal characters |
| `SPIKE_DIAGNOSTICS_TOKEN` | `Secret` | The value after `SPIKE_DIAGNOSTICS_TOKEN=` | `.dev.vars` on the installer computer | The authorization command generates a different 64-character value |

### Discord values

Enable Discord Developer Mode before you copy a server, channel, role, or user ID.

| Name | GitHub type | Enter this value | Get it here | Format/check |
|---|---|---|---|---|
| `DISCORD_APPLICATION_ID` | `Variable` | The value labeled **Application ID** | Discord Developer Portal: the bot application → **General Information** | 17 to 20 digits; do not use the application name |
| `DISCORD_PUBLIC_KEY` | `Variable` | The value labeled **Public Key** | Discord Developer Portal: the bot application → **General Information** | Exactly 64 hexadecimal characters; this is not the bot token |
| `DISCORD_GUILD_ID` | `Variable` | The server ID | Discord: open the server menu → **Copy Server ID** | 17 to 20 digits; do not use the server name |
| `DISCORD_REQUEST_CHANNEL_ID` | `Variable` | The request channel ID | Discord: open the request channel menu → **Copy Channel ID** | 17 to 20 digits; the bot must have access to this channel |
| `DISCORD_STAFF_CHANNEL_ID` | `Variable` | The staff channel ID | Discord: open the staff channel menu → **Copy Channel ID** | 17 to 20 digits; use a different channel from the request channel |
| `DISCORD_VOLUNTEER_ROLE_ID` | `Variable` | The volunteer sherpa role ID | Discord: open the volunteer role menu → **Copy Role ID** | 17 to 20 digits; do not use the role name |
| `DISCORD_STREAMER_USER_ID` | `Variable` | The streamer's Discord user ID | Discord: open the streamer user menu → **Copy User ID** | 17 to 20 digits; do not use the display name or mention |
| `DISCORD_BOT_TOKEN` | `Secret` | The bot token that you recorded during Discord setup | Discord Developer Portal: the bot application → **Bot** → **Token** or **Reset Token** | Use the bot token; do not use the public key or client secret |

### Bot settings

| Name | GitHub type | Enter this value | Get it here | Format/check |
|---|---|---|---|---|
| `COMMUNITY_ID` | `Variable` | `butcoffee` | Use this exact fixed value | Lowercase text |
| `RECIPIENT_LIMIT` | `Variable` | `4` | Use this exact fixed value | Positive integer; the raid leader uses a separate seat |
| `ATTEMPT_LIMIT` | `Variable` | `3` | Use this exact fixed value | Positive integer; this is the default attempt limit |

The legacy word `SPIKE` remains in one secret name. It does not enable a spike command.

## Complete the first deployment

Use [Streamer setup](STREAMER_SETUP.md) to run the configuration check and deployment. Then use [Upstream and deployment verification](UPSTREAM_RELEASE.md) for the smoke test.
