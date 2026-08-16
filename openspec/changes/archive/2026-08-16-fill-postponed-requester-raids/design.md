## Context

`postponeRequester` always creates a planned raid with `automatic_fill = 0`. Each later postponement therefore creates another raid, and ordinary materialization cannot use the spare seats. Historical membership rows already retain the relationship between a source raid and the follow-up containing its postponed requester.

## Goals / Non-Goals

**Goals:**

- Group requesters postponed from one source into a shared follow-up when capacity permits.
- Allow later same-map, same-queue requests to fill remaining follow-up seats.
- Preserve ordering, the reserved leader, map capacity, and atomic state changes.

**Non-Goals:**

- Mixing Ordinary and Priority requests.
- Filling whole-raid postponements.
- Changing commands, Discord controls, or the schema.

## Decisions

### Discover follow-ups from membership history

A planned raid is a follow-up for a source when it contains an open membership for a request whose source membership is historical and removed. The lookup is bounded by the source raid's requester capacity and uses existing membership indexes. This avoids a new provenance column and data migration.

### Reuse before creating

`postponeRequester` will append to the earliest planned, fillable follow-up associated with the same source, map, and queue. If none is available, it will create a fillable raid after the source's existing follow-up chain. A follow-up created when the source becomes empty retains the source's queue position when no chain exists.

### Use existing materialization policy

Follow-ups will set `automatic_fill = 1`. The current materializer will therefore consider them with other planned same-map raids in stable queue order. It will continue to bucket by queue kind, so an Ordinary request cannot enter a Priority follow-up.

### Revalidate inside the atomic batch

Candidate state and capacity will be rechecked while inserting the membership. Missing or invalid destinations will violate required membership values or the capacity trigger, rolling back the complete D1 batch. The source transition, historical membership update, destination creation when required, and new membership remain one atomic operation.

## Risks / Trade-offs

- [A follow-up fills between two requester-postponement actions] → Reuse it when capacity remains; otherwise create the next follow-up after the existing chain.
- [Historical membership lookup becomes difficult to understand] → Encapsulate it in a named repository helper and cover reuse, full capacity, and rollback with integration tests.
- [An existing test encodes isolation] → Replace that expectation with explicit fillable follow-up and whole-raid isolation tests.

## Migration Plan

Do not add a compatibility migration. The disposable DEV pilot contains planned follow-ups created by the old behavior, so clear its application rows and autoincrement sequences after deployment while preserving the canonical Discord board record and the applied baseline schema. Do not recreate D1, change its binding, reset secrets, or register Discord commands. Refresh the preserved board and verify the requester-postponement scenario from newly created data before archival.

## Open Questions

None.
