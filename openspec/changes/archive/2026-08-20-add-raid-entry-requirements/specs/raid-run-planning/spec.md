## ADDED Requirements

### Requirement: Raid calls include map entry requirements
The committed Tarkov map catalog SHALL define one mode-independent preparation reminder for each restricted location. The reminder SHALL apply identically to PvP Seasonal, PvP, and PvE and SHALL contain the approved items, fees, and conditions that players must bring for the raid.

The catalog SHALL define these reminders:

- The Lab: each player needs a TerraGroup Labs access keycard.
- The Labyrinth: each player needs a Labrys access keycard, and the party needs one Knossos LLC facility key.
- Terminal: each player needs one accepted access option: a Reprogrammed RFID keycard with Mr. Kerman's hash codes together with the Secure container Alpha-1 with TerraGroup evidence, an RFID keycard with unknown name, a Reprogrammed RFID keycard with Prapor's hash codes, or Prapor's letter for the port checkpoint. Entry is through Shoreline from 21:00 to 06:00.
- Icebreaker: each player needs the current Rouble entry fee and the current Euro exit fee; the reminder SHALL NOT commit numeric amounts.

When `Call and start raid` requests a platform call for a restricted location, the Discord call and any requested Twitch call SHALL append concise `Bring:` guidance derived from that location's catalog entry. Both calls SHALL retain their existing requester identities, Discord mention allowlist, mode and map, delivery rules, and call-status transitions. Calls for all other committed locations SHALL add no preparation-requirement text. Reminders SHALL NOT include extraction items or fees except for Icebreaker's required Euro exit fee, optional room keys, equipment recommendations, or quest objectives.

#### Scenario: Discord calls requesters for The Lab
- **WHEN** eligible staff start a reviewed raid for The Lab in any supported game mode
- **THEN** the Discord call retains its current mentions and tells each player to bring a TerraGroup Labs access keycard

#### Scenario: Twitch calls requesters for The Labyrinth
- **WHEN** the streamer starts a reviewed raid for The Labyrinth and a Twitch call is requested
- **THEN** the Twitch call retains the current requester tags and tells each player to bring a Labrys access keycard and the party to bring one Knossos LLC facility key

#### Scenario: Terminal call lists accepted access options
- **WHEN** a Terminal raid call is sent
- **THEN** it identifies the accepted per-player access alternatives, the combined Mr. Kerman-card and Alpha-1-container option, and the Shoreline 21:00-to-06:00 entry condition

#### Scenario: Icebreaker call covers entry and exit fees
- **WHEN** an Icebreaker raid call is sent
- **THEN** it tells each player to bring the current Rouble entry fee and current Euro exit fee without naming numeric amounts

#### Scenario: Standard map call remains concise
- **WHEN** a raid call is sent for a committed map without an entry requirement
- **THEN** its existing content has no `Bring:` guidance

#### Scenario: Requirement text is identical across modes
- **WHEN** calls are rendered for the same restricted location in PvP Seasonal, PvP, and PvE
- **THEN** every call uses the same catalog entry requirement apart from its existing mode label

#### Scenario: Longest Twitch call remains valid
- **WHEN** the maximum supported requester party has maximum-length valid Twitch logins and the longest entry reminder
- **THEN** the complete Twitch call remains within the platform message-length limit
