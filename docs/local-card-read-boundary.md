# Shared local Pokemon card reads

With POKEMON_LOCAL_CATALOG=1, the shared cardApi dispatcher reads Pokemon card details from the existing cache using the exact original ID, and its hydrate operation makes no remote metadata or pricing request. Cached legacy Pokemon identifiers remain readable without being converted to another provider's IDs. Missing cards return null for the caller to handle; they do not silently contact a public provider. The flag is off by default.

Cross-language resolution requires a matching canonical TCGdex ID in the target language's active local snapshot. It refuses regional-language prefix substitution and does not invent a physical printing from a translated name. Other games and flag-off dispatch retain their prior behavior.

The returned artwork_status describes only whether a provider image reference exists. It does not establish image download success, local image bytes or scanner coverage. CardDex fallback/lookup, final PokeWallet fallback, automatic bundle delivery/import, persistent image repair, Admin controls and complete scanner/startup-job cutover remain required. Direct provider calls outside cardApi must still be audited; this is not a claim that all routes are offline. No production flag, collection reference, import or deployment is changed by this commit.
