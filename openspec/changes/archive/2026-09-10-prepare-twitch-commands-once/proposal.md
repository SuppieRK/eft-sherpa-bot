## Why

The Twitch handler coordinates command recognition, request validation, and error guidance, then parses valid request arguments again. A canonical OpenSpec requirement also describes a waiting-queue materialization path that the current code no longer uses.

## What Changes

- Prepare complete Twitch chat commands once before any D1 work.
- Keep recognized, validated request data for execution. Remove the unused raw command representation and separate request-parser module.
- Keep command syntax, aliases, default goals, typo guidance, limits, and delivery behavior unchanged.
- Correct the canonical grouping requirement to describe atomic request assignment and operator-only legacy repair.
- Keep the change available for later bulk archival.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cross-platform-commands`: Correct the obsolete grouping requirement to match the accepted runtime model. Command preparation is an internal refactor.

## Impact

Twitch command preparation, Worker dispatch, parser and Worker tests, benchmark reports, and OpenSpec. No SQL, migration, dependency, command, or hosting change.
