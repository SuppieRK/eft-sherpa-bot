## Context

The bot resolves every request and raid to a committed `TarkovMapDefinition`. The same catalog already owns canonical map names, aliases, source identifiers, and sherpa party capacities. Raid calls are rendered in one Discord integration path before an optional Twitch call is sent.

Four committed locations have requirements that players must bring for the raid: The Lab, The Labyrinth, Terminal, and Icebreaker. These requirements are the same for PvP Seasonal, PvP, and PvE. The feature is a preparation reminder; it does not validate player inventories or game progression.

## Goals / Non-Goals

**Goals:**

- Keep one typed, mode-independent entry-requirement definition beside each map.
- Add concise `Bring:` guidance to Discord and Twitch calls for restricted locations.
- Preserve existing mentions, call delivery, and status handling.
- Test every restricted map and the absence of a reminder for standard maps.

**Non-Goals:**

- Store requirements in D1 or add operator configuration.
- Track whether a requester owns an item or has unlocked a location.
- Include extraction costs or items except for Icebreaker's required Euro exit fee, or include optional room keys, equipment, or quest objectives.
- Change request grouping, map capacities, commands, or raid state transitions.

## Decisions

### Store optional call guidance in the map catalog

Extend `TarkovMapDefinition` with optional immutable entry-requirement text. The four restricted map records carry the approved text and all other map records omit it. The existing map resolver supplies both the display name and requirement, so aliases and source variants cannot produce a different reminder.

This is preferable to a database table because the values are product-owned game facts, do not vary by community or game mode, and must change only with a reviewed release. It is preferable to a separate map-ID switch in the Discord adapter because that would duplicate catalog ownership.

The committed catalog is:

- The Lab: each player brings one TerraGroup Labs access keycard.
- The Labyrinth: each player brings one Labrys access keycard; the party brings one Knossos LLC facility key.
- Terminal: each player brings one accepted access option: a Reprogrammed RFID keycard with Mr. Kerman's hash codes together with the Secure container Alpha-1 with TerraGroup evidence, an RFID keycard with unknown name, a Reprogrammed RFID keycard with Prapor's hash codes, or Prapor's letter for the port checkpoint. The reminder also states that entry is through Shoreline from 21:00 to 06:00.
- Icebreaker: each player brings the current Rouble entry fee and the current Euro exit fee. No numeric amount is committed because the live fees can change independently of a bot release.

### Append one shared reminder to both platform calls

Build one concise suffix from the resolved map and append it to both Discord and Twitch call content. A restricted-map call adds `Bring: <requirements>`. A standard-map call remains unchanged. Discord mention allowlisting remains unchanged, and the Twitch message continues to direct requesters to Discord.

Shared catalog text prevents platform drift. The renderer must keep the longest supported call within platform message limits for the maximum requester count and valid Twitch-login lengths.

### Treat requirements as release-managed static data

The implementation changes TypeScript only. It requires no D1 migration or data backfill, and rollback to the previous Worker is structurally safe. Tests validate that every committed restricted map has the intended reminder and that no other map produces one.

## Risks / Trade-offs

- [Game entry and exit fees can change] → Keep the data in one reviewed catalog and avoid committing Icebreaker's volatile numeric fees.
- [Terminal guidance is long] → Use concise catalog wording and test the maximum Twitch call length.
- [A requirement could be confused with an extraction recommendation] → Limit the field and tests to entry requirements plus the explicitly approved Icebreaker exit fee.
- [Platform messages could diverge] → Generate both suffixes from the same resolved map definition.
