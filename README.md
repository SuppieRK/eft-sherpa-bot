# EFT Sherpa Bot

EFT Sherpa Bot plans Escape from Tarkov help raids for the butcoffee community. It receives help requests from Twitch and Discord. It groups compatible requests into raids. It gives staff a visual Discord board.

## Main functions

- Twitch viewers use `!request [map] [goal]` and `!queue`.
- Discord viewers use `/request`, `/queue`, and `/link-twitch`.
- The streamer and volunteer sherpas use `/board`.
- The bot limits each raid to the map party size and keeps one place for the sherpa.
- The bot records raid attempts and moves postponed raids to the priority queue.
- The bot stores queue data in Cloudflare D1.

See [Bot operation](docs/BOT_OPERATION.md) for the complete command behavior.

## Installation roles

The streamer owns these items:

- the GitHub fork;
- the Cloudflare account;
- the Twitch application and bot account;
- the Discord application.

The technical installer prepares these items. The streamer does not need a command line.

Start with [Streamer setup](docs/STREAMER_SETUP.md). The technical installer must also use [Installer setup](docs/INSTALLER_SETUP.md).

## Updates

The maintainer publishes a verified release. The streamer selects **Sync fork** and runs the **Deploy production** workflow. The bot does not install an update automatically.

See [Update the bot](docs/UPDATE.md).

## Development

Install Node.js 26 and npm 12. The required versions are in `.node-version` and `.npmrc`.

Run these commands:

```text
npm ci
npm run verify
```

`npm run verify` checks format, lint rules, TypeScript, unused code, migrations, documentation, workflows, tests, the Worker build, and tracked secrets.

Run `npm run benchmark:d1` to measure user operations with a fully local D1 database. The benchmark cannot use a remote D1 database.

See [Contributing](CONTRIBUTING.md) before you send a change.

## Security

Do not put a token, client secret, private key, or password in this repository. Use GitHub environment secrets or ignored local files.

See [Security policy](SECURITY.md) to report a security problem.

## License

This project uses the MIT License. See [LICENSE](LICENSE).
