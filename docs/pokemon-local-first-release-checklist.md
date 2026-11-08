# Pokemon local-first release acceptance

This branch is not a completed migration. Passing unit tests and application image builds do not establish that an upstream metadata bundle has been produced, delivered, imported or connected to every runtime endpoint.

## Current verified boundaries

- Local snapshot storage, synchronization controller and compiled-bundle validation exist.
- An opt-in local set listing is mounted behind the existing authentication gate. Its flag is off by default, and it intercepts explicit game=pokemon set requests only.
- Full catalog build run 42493574442 failed in packaging/test import and produced no artifact. Its exact remaining failure must be resolved before bundle delivery is called working.
- No production metadata import, provider switch, merge or deployment has been performed as part of these branch changes.

## Required backend and API work

- [ ] Produce and test-import real compiled upstream bundles successfully.
- [ ] Securely deliver and validate bundles on a running instance; preserve the last working snapshot on failure.
- [ ] Connect scheduled and manual synchronization to delivered bundles.
- [ ] Serve Pokemon search, set listings, card details and scanner hydration locally, with public metadata APIs blocked in integration tests.
- [ ] Preserve collection ownership, card IDs, paid acquisition costs and existing quotes during metadata updates.
- [ ] Distinguish absent metadata, missing artwork references, failed artwork downloads and absent scanner embeddings.
- [ ] Validate scanner artifact/model versions, card mappings and coverage before replacing a working index.
- [ ] Exercise upgrades, failed sync, missing-language snapshots, restart, throttling and rollback.

## Pricing direction and constraints

CardDex is the candidate primary source and PokeWallet remains fallback. This is a direction, not a completed provider integration or a claim of universal coverage.

- [ ] Validate native and compatibility response contracts before enabling price writes.
- [ ] Use explicit provider mappings and verify physical printing, language, set, number, finish/variant and edition; translations alone do not establish a physical-language printing.
- [ ] Preserve our local card IDs rather than reminting collection references from external provider IDs.
- [ ] Retain provider, underlying market source, currency, quote timestamp and freshness information. Never silently mix currencies or substitute a different finish.
- [ ] Handle the native base_finish and variant is_base fields explicitly; a variant named normal is not sufficient evidence of a non-holo physical finish.
- [ ] On the free plan, cache prices fetched for user-needed cards/products only. Do not mirror whole-catalogue prices or create an archive of past CardDex prices. Keep metadata bundles free of CardDex quotes. Recheck current terms before enabling pricing.
- [ ] Add required CardDex attribution, keep keys server-side, and enforce per-minute/per-day limits, backoff and request deduplication.
- [ ] Keep unpriced/ambiguous records unknown, not zero. Fallback must pass the same identity and freshness checks as the primary source.

The live contract probe and provider terms excerpts are recorded on draft PR 13. Their coverage figures are dated/provider-published snapshots, not independently verified completeness guarantees.

## Admin settings and controls are release requirements

- [ ] Separate metadata synchronization, artwork availability, scan-catalog readiness and market-price refresh status.
- [ ] Display per-language snapshot revision, last successful sync, in-progress work, failures and next scheduled check.
- [ ] Offer clear manual sync/update actions with prerequisite checks and no success-looking zero-card builds.
- [ ] Show CardDex primary/PokeWallet fallback configuration, masked key state, limits/cooldowns and source/freshness information.
- [ ] Keep advanced legacy product-map/local-build controls only while an actual supported runtime path needs them; label that dependency.
- [ ] Remove obsolete provider settings and controls only after all callers, startup jobs, scheduled jobs and migrations have been reviewed.

## README and housekeeping gate

- [ ] Update README setup, configuration, sync lifecycle, pricing providers, attribution, scanner prerequisites, limitations, migration and recovery instructions to match the shipped implementation.
- [ ] Audit routes, provider clients, background jobs, settings columns, UI controls, environment variables, tests, dependencies, packaging and CI for unreachable or deprecated functionality.
- [ ] Inventory and remove completed one-off repair/diagnostic workflows and patch scripts after their source changes and regression coverage are verified. This includes assistant-added automation; do not leave obsolete hash-guarded repair jobs as permanent release machinery.
- [ ] Review non-Pokemon functionality and provider retirement without automatically deleting existing user data or breaking historical collection records.
- [ ] Review security, authorization, secret handling, rate limits and artifact provenance; run regression, frontend lint/test/build and packaging checks on the final head.
- [ ] Preserve the four dashboard tabs, five approved summary cards, Investment Cost chart label and rip-completion behavior.
- [ ] Perform final diff/dependency review and explicitly document retained compatibility paths before release approval.
