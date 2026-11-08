# Importing compiled TCGdex repository data

This adapter consumes the official compiler's generated `<language>/cards.json` and `sets.json` arrays. It does not fetch cards from the public TCGdex API, guess identifiers from source filenames, execute TypeScript, or download card images. The resulting loader can be supplied as `loadSnapshot` to `createPokemonCatalogSync`.

## Preparation boundary

Build a deliberately selected commit of `tcgdex/cards-database` outside the production web process, using upstream's documented Bun build in an isolated, unprivileged environment without production secrets or database mounts. Upstream currently uses frozen root/server lockfiles and `bun run compile` from `server`. Its compiler handles translations, `data-asia`, identity generation and image references. The compiler reads `https://assets.tcgdex.net/datas.json`; a pinned Git commit therefore does not pin every asset input. Failed compilation must not replace a working bundle. Do not run automatic dependency installation or arbitrary upstream code inside the application server.

The build output is `server/generated`. Copy the full upstream `LICENSE` into that generated directory before packaging. Keep it with every distributed bundle. No image redistribution permission is inferred from this software/database notice.

## Package and inspect

```
node backend/scripts/pokemon-catalog-bundle.js manifest /path/to/generated UPSTREAM_COMMIT en,ja
node backend/scripts/pokemon-catalog-bundle.js verify /path/to/generated UPSTREAM_COMMIT en
node backend/scripts/pokemon-catalog-bundle.js import /path/to/generated UPSTREAM_COMMIT en
```

The final command is a dry run unless `--apply` is present. Replace `UPSTREAM_COMMIT` with the exact 40-character commit checked out by the isolated build. Languages must have generated exports; there is no fallback to English. The manifest binds byte sizes, record counts and SHA-256 hashes for each language's files and the license notice. These checks detect corruption, mismatches and incomplete publication; they are not cryptographic proof that an untrusted publisher used the claimed source commit. Only consume bundles produced by an operator-controlled build process.

## Explicit import

```
node backend/scripts/pokemon-catalog-bundle.js import /path/to/generated UPSTREAM_COMMIT en --apply
```

This targets the application's configured existing database and uses a dedicated transactional connection. It does not initialize a new installation, select a new provider, mount API routes or start a scheduler. Back up the existing database and validate in a development instance first. Metadata imports preserve price columns, price timestamps and existing identities; scan artifacts still need independent updates.

Publish new bundles in separate versioned directories. Do not overwrite a directory a running loader is reading. A new directory should be validated before swapping the configured bundle reference. Same-commit normalized-content drift remains rejected by the store; an updated asset manifest can cause such drift and requires explicit handling rather than silently rewriting a checkpoint.

## Remaining release integration

Automated isolated builds, secure bundle delivery, live local API routing, Admin controls, scanner artifact synchronization, pricing queue hardening and Pokémon-only cleanup are not enabled by this increment. Existing production requests still use their current routes. No production keys are required to run bundle validation.
