# Contributing

Thank you for your interest in EFT Sherpa Bot.

## Prepare the project

1. Install Node.js 26.
2. Install npm 12.
3. Create a branch from `main`.
4. Run `npm ci`.
5. Make one focused change.
6. Run `npm run verify`.
7. Open a pull request.

Do not add a credential or a real community platform ID.

## Write documentation

Use ASD-STE100 Simplified Technical English for public documentation.

- Use short sentences.
- Use the active voice.
- Use one term for one item.
- Use `select` for a user-interface control.
- Do not use contractions or idioms.
- Put a warning before a dangerous action.

The canonical MIT license text does not use this writing rule.

## Change the database

Do not edit a migration that exists in a published release. Add a new numbered migration. Keep the migration compatible with the previous Worker version.

## Change a workflow

Keep permissions at the minimum value. Pin each external Action to a full commit SHA. Do not give a pull-request job access to a deployment secret.
