# Missing English artwork repair: first increment

This adds the server-side repair core and a dry-run-first CLI. Automatic browser repair and the CardDex adapter are NOT wired by this commit. There is no guarantee PokéWallet has an image for a particular card. CardDex may share TCGdex image gaps.

From the repository root, with the same environment and database configuration as the running backend:

    node backend/scripts/repair-pokemon-artwork.js tcgdex-en-30th-c-012

Verify the printed database path and printing identity before explicitly applying:

    node backend/scripts/repair-pokemon-artwork.js --apply tcgdex-en-30th-c-012

Preview performs authenticated provider metadata requests and may update shared response caches and request-budget counters; it does not alter card records or artwork. The configured database PokéWallet key takes precedence over POKEWALLET_API_KEY. Never paste a key into command arguments or chat.

Only cards in the active English physical catalogue with no provider image reference are eligible. A unique English set and a complete search result page must agree on printing identity. No name-only guess, cross-language substitution, sealed product or ambiguous variant is accepted.

Image bytes stay server-side, are size/pixel/type/aspect bounded, decoded and re-encoded as PNG, and installed atomically without overwriting existing art. They use the existing local card-art serving path. Card IDs, card_cache metadata/price fields, collection quantities and purchase history are not modified. Apply records failures with a retry time. Existing cached art wins on later attempts.

Requests use the existing PokéWallet cache and budget tables, including hourly/day counters and shared cooldowns. Transport and quota integration still need additional regression coverage before automatic UI activation. Generated artwork is local instance data, not a repository asset; do not commit it or the metadata ZIP. Refresh the browser after a successful repair so its card-art index reloads. These files are not automatically included in scanner indexes, and provider-reference counts do not count custom/local artwork.
