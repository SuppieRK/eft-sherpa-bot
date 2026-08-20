## Why

Some Tarkov locations require access items or an entry fee. Requesters can miss or delay a sherpa raid when the bot calls them without telling them what they must bring.

## What Changes

- Add one mode-independent entry-requirement list to the committed map catalog.
- Include the selected map's entry requirements in Discord and Twitch requester calls.
- Cover The Lab, The Labyrinth, Terminal, and Icebreaker; standard maps have no entry-requirement text.
- Keep extraction items and fees, optional room keys, equipment, and quest objectives out of reminders, except for Icebreaker's required exit fee.
- Describe Icebreaker's volatile charges as the current Rouble entry fee and current Euro exit fee instead of committing numeric amounts.

## Capabilities

### New Capabilities

- None.

### Modified Capabilities

- `raid-run-planning`: Raid calls identify the map-specific items or fee that current requesters must bring.

## Impact

- Extends the hardcoded Tarkov map catalog and its validation.
- Changes Discord and Twitch call-message rendering without changing commands, grouping, D1 schema, or game-mode behavior.
- Adds focused catalog, call-message, and regression tests.
