# Streamer setup

This procedure uses the GitHub website. You do not need a command line.

The technical installer must be available during this procedure. The installer enters technical values. Do not send a secret in Discord, Twitch, email, or an issue.

## Create the fork

1. Sign in to [GitHub](https://github.com/).
2. Open [SuppieRK/eft-sherpa-bot](https://github.com/SuppieRK/eft-sherpa-bot).
3. Select **Fork**.
4. Select your GitHub account in **Owner**.
5. Keep `eft-sherpa-bot` in **Repository name**.
6. Select **Copy the main branch only**.
7. Select **Create fork**.
8. Wait until GitHub opens your fork.

GitHub has more information in [Fork a repository](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/working-with-forks/fork-a-repo).

## Enable GitHub Actions

GitHub does not enable workflows in a new fork.

1. Open the **Actions** tab in your fork.
2. Read the workflow warning.
3. Select **I understand my workflows, go ahead and enable them**.
4. Confirm that **CI** is in the workflow list.

## Create the production environment

1. Open **Settings** in your fork.
2. Select **Environments**.
3. Select **New environment**.
4. Enter `production`.
5. Select **Configure environment**.
6. Select **Required reviewers**.
7. Add your GitHub account as a reviewer.
8. Keep **Prevent self-review** clear.
9. In **Deployment branches and tags**, select **Selected branches and tags**.
10. Add the branch rule `main`.
11. Save the protection rules.

GitHub has more information in [Deployment environments](https://docs.github.com/en/actions/reference/workflows-and-actions/deployments-and-environments).

## Add environment values

The technical installer must add the provider values in [Installer setup](INSTALLER_SETUP.md). Each table row gives the exact value, source, format, and GitHub type.

Do not put a secret in a variable. GitHub shows variables as plain text.

## Check the configuration

1. Open the **Actions** tab.
2. Select **Check production configuration**.
3. Select **Run workflow**.
4. Select the `main` branch.
5. Select **Run workflow** again.
6. Open the new workflow run.
7. Select **Review deployments** when GitHub asks for approval.
8. Select `production`.
9. Select **Approve and deploy**.
10. Confirm that the workflow is green.

## Run the first deployment

1. Open the **Actions** tab.
2. Select **Deploy production**.
3. Select **Run workflow**.
4. Select the `main` branch.
5. Select **Run workflow** again.
6. Wait for **Verify selected commit** to finish.
7. Select **Review deployments**.
8. Select `production`.
9. Select **Approve and deploy**.
10. Wait for **Deploy and verify** to finish.
11. Open the deployment summary.
12. Confirm that Discord, Twitch, and Worker health show `ready`.

Ask the technical installer to complete the smoke test before viewers use the bot.
