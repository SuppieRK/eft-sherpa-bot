# Tarkov map catalog snapshot

Catalog version `2026-08-14.1` uses the `pve` maps response from
<https://json.tarkov.dev/pve/maps?lang=en>. The retrieval date was 2026-08-14. The SHA-256 value of the
response was `b778d4233760c546d7359304ab27cd02f2646bdead0a29863e26d66d4046d061`.
The file `docs/data/tarkov-maps-2026-08-14.json` contains the fields that the release uses.

The source gives location IDs, names, and variants. The `players` ranges give the total number of
players in a raid. They do not give the party capacity. The catalog does not use these ranges for
party capacities.

The catalog combines day, night, level-gated, tutorial, and dark variants into one map choice. It
keeps each source variant. Tests use these variants to find omitted locations after an update.

`sherpaPartyCapacity` is the maximum party size, including the streamer or volunteer leader. Each
supported map has a party capacity of five except Icebreaker. Icebreaker has a party capacity of
three. The catalog stores these reviewed values directly.

To update the catalog:

1. Save a fresh response and calculate its SHA-256.
2. Review added, removed, or renamed locations.
3. Review changes to the party limits.
4. Update the source location IDs and variants.
5. Increase the catalog version and update this record.
6. Run `npm run verify` before release.
