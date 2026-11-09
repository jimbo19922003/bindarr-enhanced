# Local search and remaining fallback integration

Target order: imported TCGdex metadata served by our local API first, CardDex fallback/lookup second, PokeWallet last resort. Card identity, artwork recovery and pricing are separate decisions; an absent quote must not cause replacement with a different printing. Preserve local IDs, physical language, variant/edition and currency provenance.

When local Pokémon mode is enabled from Admin → Catalog, the guarded route integration serves Pokemon search from the active language snapshot for both database and internet scopes. The response remains a card array with the existing total-count header. Collection scope remains user-isolated and includes owned cards regardless of their printing language. Missing catalog snapshots return sync-required rather than a public metadata fallback. The setting is persisted and changes take effect immediately without a restart. The existing authentication gate, limiter, search normalization and optional scan scoring remain in place.

Local search does not run the previous unconditional PokeWallet overlay. CardDex fallback and a correctly matched final PokeWallet fallback still require adapters, budgeting, attribution and integration tests before they are enabled.

The build currently packages metadata and artwork references, not all image bytes. artwork_status reports provider_reference_available or missing_provider_reference only: a URL is not proof of a successful download, a local cached image or a scanner embedding. Neither the complete compiled source nor CardDex guarantees artwork for every card. The existing cache preservation fix prevents an empty refresh from erasing an existing URL; it does not restore previously absent URLs.

Next required artwork work: report per-set missing references, identify failed URLs, introduce validated persistent image delivery/repair for exact card identities, and show separate metadata/image/scan readiness in Admin. Already-missing artwork requires diagnosis and verified repair, not guessed image paths or remapped collection IDs.
