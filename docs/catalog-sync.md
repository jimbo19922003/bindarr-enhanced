# Local catalog API and synchronization boundary

The release targets Bindarr-owned local catalog endpoints, not a live proxy to the public TCGdex API and not an implementation of every unrelated TCGdex endpoint. Normal search, set browsing and scanner hydration must eventually read the local database. Until route cutover is implemented and tested, the production paths remain unchanged.

## Background synchronization controller

`pokemonCatalogSync` checks the fixed `tcgdex/cards-database` master commit endpoint with an ETag, then asks an explicitly supplied repository adapter for each changed language at that exact commit. It refuses a mismatched commit or language before publication. The store validates and publishes each language snapshot transactionally. A failed refresh leaves that language's previous active snapshot available. Language snapshots publish separately, not as one cross-language transaction.

The proposed default is a six-hour scheduled check plus the same sync action from an authenticated Admin button. This increment provides the controller but does not mount the button, start a timer, download source code or switch API routes. `start()` only schedules future checks; `sync()` explicitly triggers a check. Concurrent requests in one Node process share an inflight job. This is not a distributed worker lock: a multi-process deployment will need a persistent lease before enabling multiple schedulers.

An optional server-side `TCGDEX_GITHUB_TOKEN` can authenticate public repository reads. Credentials are not exposed by status responses. Rate-limit headers extend cooldown; repeated manual clicks do not bypass cooldown. ETag and cooldown state are currently process-local; successful import checkpoints persist in the catalog store. Restarting causes a fresh commit check, not an unconditional catalog reimport.

## Remaining release work

- Implement and test the upstream TypeScript-to-resolved-snapshot adapter, including data-asia, translations, stable identities and verified asset references. Do not execute source code from arbitrary repositories.
- Wire the local API and route all relevant catalog/scanner hydration calls to it; verify operation with the public TCGdex API blocked.
- Add authenticated Admin sync controls and persistent multi-process job coordination if needed.
- Update scanner artifacts independently of metadata, with validation and atomic artifact publication. A new database snapshot does not mean a newly released card is visually recognizable.
- Keep PokéWallet pricing and image-host availability separate. Local metadata avoids public catalog API outages but does not manufacture missing upstream data or guarantee image availability.
- Complete Pokémon-only cleanup without automatic deletion of legacy user data or dashboard redesign.
