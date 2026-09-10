## Context

Command recognition returns raw Twitch arguments. The Worker validates them before D1, then parses them again after claiming the delivery. Invalid guidance is also in the Worker. The current behavior is correct but its preparation rules span several callers and files.

## Goals / Non-Goals

**Goals:** One preparation interface for complete chat text; retain validated fields for execution; preserve zero-D1 invalid guidance; reconcile the stale grouping requirement.

**Non-Goals:** New syntax, response text, receipt policies, SQL, migrations, adapters, or hosting. No performance claim beyond removing duplicate parsing; D1 costs must remain unchanged.

## Decisions

### Prepare complete commands in the Twitch module

The Twitch public-command module owns recognition, mode and map interpretation, default goals, validation, and invalid guidance. Its result distinguishes ignored chat, guidance, and a ready command. A ready request contains its mode, resolved map, and goal, not raw arguments. Execution accepts only ready commands.

Move the grammar from the separate domain request-parser file into this module, then remove that file and its unused raw-command representation. Keep generic mode and map catalog functions in their existing modules. This reduces caller knowledge rather than adding a forwarding function over the same exposed protocol.

Keep the existing command-recognition expression and exact guidance text. Signature verification and broadcaster checks remain before command preparation. Guidance delivery remains best-effort without a D1 receipt. Valid commands retain their existing receipt, identity, assignment, reply, and board work.

### Test complete text at the preparation interface

Move the request-parser examples into full-chat-input tests. Cover all modes and aliases, case and whitespace, map aliases, default and explicit goals, the 150-character limit, typo guidance, ignored chat, and rejected queue arguments. Retain Worker-level duplicate and delivery tests. Strengthen invalid-command tests to assert zero D1 binding calls, not only empty tables.

### Correct documentation without changing runtime grouping

Update only the obsolete grouping requirement and its scenarios in the canonical cross-platform specification. Record the same full requirement as a delta for later bulk archival. New requests already commit a planned request and membership atomically. Queue reads do not repair unrelated waiting requests. Legacy repair remains an explicit authenticated operator action.

## Risks / Trade-offs

- Recognition or guidance can drift during consolidation. Preserve the expression and add complete-input regression cases.
- Tests that only check empty tables miss read-only D1 regressions. Assert binding-call counters through complete Worker requests.
- A new preparation module can become a forwarding module. Remove the obsolete intermediate representation and old parser rather than retaining both.
- Canonical and delta text can diverge before archival. Validate both and keep the corrected requirement identical.

## Migration Plan

No migration or deployment in this task. Run verification and the fully local benchmark. Leave all changes available for the user's later bulk archival.

## Open Questions

None. The user approved both scoped changes with behavior and cost preserved.
