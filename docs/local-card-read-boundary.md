# Shared local Pokemon card reads

When local Pokémon mode is enabled from Admin → Catalog, the shared cardApi dispatcher reads Pokemon card details from the existing cache using the exact original ID, and its hydrate operation makes no remote metadata or pricing request. Cached legacy Pokemon identifiers remain readable without being converted to another provider's IDs. Missing cards return null for the caller to handle; they do not silently contact a public provider. The setting is persisted and takes effect without a restart.

Cross-language resolution requires a matching canonical TCGdex ID in the target language's active local snapshot. It refuses regional-language prefix substitution and does not invent a physical printing from a translated name. Other games and flag-off dispatch retain their prior behavior.

The returned artwork_status describes only whether a provider image reference exists. It does not establish image download success, local image bytes or scanner coverage. Direct provider calls outside cardApi must still be audited; this is not a claim that every route is offline.
