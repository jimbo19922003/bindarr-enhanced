# Automated candidate catalog builds

`build-pokemon-catalog.yml` builds candidate metadata bundles from a resolved, pinned upstream checkout. It runs the catalog regression tests before compiling, builds upstream in a restricted Docker container, packages the selected language exports with their full upstream LICENSE, then imports the actual bundle into a disposable SQLite database. It verifies stable scanner-facing IDs, preservation of existing price fields and collection references, counts and repeat-import behavior before uploading a GitHub Actions artifact. The validator never imports the application's configured database module or opens a production database.

The compiler container receives only the public upstream checkout, one read-only compiler script and an output directory. The upstream checkout is mounted read-only and copied into temporary container storage. There is no application source, deployment environment, database volume, Docker socket or production secret mounted in it. Network access is required for locked dependencies and upstream's asset metadata manifest. Resources and job runtime are limited. The Bun major-version base image is not a digest-pinned reproducible toolchain; generated file hashes remain validated independently.

## Triggers and delivery boundary

The first release-branch push touching pipeline files starts a candidate build. A manual input can pin a commit and select languages; defaults are English and Japanese. GitHub schedules execute from the default branch, so the six-hour schedule will not take effect merely because this file exists on a release branch. Workflow-dispatch discovery likewise depends on the repository's default-branch workflow registration. After this release merges, the schedule produces new candidate bundles; this version may rebuild unchanged upstream data rather than reusing previous build artifacts.

Delivery in this increment means a versioned GitHub Actions artifact with 30-day retention, not an automatically installed server update or a permanent published data release. Run ID and attempt distinguish repeated builds of the same upstream commit. Artifacts contain metadata JSON and license text, not image files or scanner embeddings. They are usable through the existing bundle loader and dry-run import command. Secure automatic retrieval/promotion into a running instance is still required.

## Release blockers remain

The broader verify check must pass before release readiness. This pipeline does not change or bypass it. Local API route cutover, Admin synchronization controls, scanner artifact publication, PokéWallet queue hardening and Pokémon-only cleanup remain separate required work. The four dashboard tabs, five cards and rip-checkbox fix are unchanged. No application deployment, production import or release publication is performed by this workflow.
