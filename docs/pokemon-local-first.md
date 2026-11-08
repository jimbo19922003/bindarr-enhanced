# Pokemon local-first release: storage increment

Status: additive storage foundation; not yet selected by live routes.

The local catalog store accepts a resolved TCGdex-shaped snapshot for one explicit language and pinned repository commit. It does not parse or execute upstream TypeScript. A repository-to-snapshot adapter, scheduled synchronization, Admin controls, scanner artifact updates, price queue hardening and Pokemon-only application cleanup remain subsequent increments. No deployment or provider selection changes are included here.

## Contracts

- Existing `tcgdex-<language>-<provider-id>` identifiers are retained verbatim; collector numbers do not regenerate IDs. Existing non-TCGdex identifiers are not migrated or guessed.
- Metadata imports use explicit metadata-only upserts into `card_cache`, not replacement rows. Price columns and price timestamps are not updated. Collection and sale records are not touched.
- Localized set records live in language-specific catalog snapshots instead of overwriting the legacy language-agnostic sets table.
- A failed import rolls back metadata and active-snapshot changes. A successful import retains older cache rows for collection and scanner references; only active browsing membership changes.
- The existing scanner implementation and artifact formats are not modified. New imports flag scan refresh as required; this increment does not claim to build or validate embeddings. Database completeness and scan coverage remain separate.
- Pocket (`tcgp`) data is excluded from physical-card catalog snapshots. Missing artwork remains missing; only explicit TCGdex asset references are accepted, and images are not downloaded or redistributed here.
- This is not a price importer. PokéWallet mapping, variant/language verification and shared rate-limited refreshes remain separate.
- The four dashboard tabs and five summary cards remain unchanged. Legacy non-Pokemon user data is not deleted.

## Validation

Run `node --test backend/src/utils/pokemonLocalCatalog.test.js` with the existing sqlite3 dependency installed. The release workflow runs these tests independently of production data. No importer is started at boot by this increment.
