## 1. Map entry-requirement catalog

- [x] 1.1 Extend the typed Tarkov map definition with optional immutable entry-requirement guidance and populate the approved requirements for The Lab, The Labyrinth, Terminal, and Icebreaker.
- [x] 1.2 Add catalog tests that assert the exact restricted-map set and content, no reminder for every standard map, mode independence, both Icebreaker fee currencies, and no numeric Icebreaker amounts.

## 2. Cross-platform raid calls

- [x] 2.1 Add one shared formatter for an optional `Bring:` suffix derived from the resolved map catalog entry.
- [x] 2.2 Append the shared suffix to Discord and requested Twitch raid calls while preserving identities, mention allowlisting, delivery rules, and call-status handling.
- [x] 2.3 Add call-message tests for every restricted map on Discord and Twitch, unchanged standard-map calls, all supported game modes, and the maximum-length Twitch call.

## 3. Verification

- [x] 3.1 Run focused unit and integration tests for the catalog and staff-board call workflow.
- [x] 3.2 Run the complete repository verification suite and strict OpenSpec validation; resolve all failures before handoff.
