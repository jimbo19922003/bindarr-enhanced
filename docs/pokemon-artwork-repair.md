# Missing English artwork repair

The repair command now follows local artwork, then CardDex, then PokéWallet emergency fallback. Automatic browser repair is still NOT connected. No provider is guaranteed to have an image for a particular printing.

From the repository root, with the running backend's database configuration:

    node backend/scripts/repair-pokemon-artwork.js tcgdex-en-30th-c-012

The preview lists the provider attempts. CardDex uses anonymous requests with no PokéWallet key. PokéWallet is contacted only after CardDex has no verified candidate or fails. Preview matches metadata but does not download image bytes. It can update response caches and provider request counters.

Only after reviewing the database path and printing identity:

    node backend/scripts/repair-pokemon-artwork.js --apply tcgdex-en-30th-c-012

Apply can try the emergency provider if downloading CardDex artwork fails. The existing image writer decodes and bounds the resulting image and installs a PNG atomically without replacing existing local art. It does not change card IDs, prices, collection rows or purchase records. Image decoder rejection after download does not yet attempt another provider. Failed full-chain attempts have a retry time; older PokéWallet-only negative attempts do not suppress the new CardDex lookup.

CardDex metadata responses are cached for one hour; request reservations are persisted with conservative ceilings of 25 per minute and 4,500 per day, including image downloads. A 429/503 establishes a shared CardDex cooldown. These limits apply to this adapter, not unrelated future CardDex clients. HTTPS image destinations are restricted to images.carddex.dev and English assets.tcgdex.net paths, with no redirects, URL credentials, query strings or arbitrary browser-supplied URL. Printing identity, English language context and complete result coverage are required.

Data by CardDex: https://carddex.dev. Attribution is visible on Add Cards. PokéWallet keeps its existing database/environment key configuration and shared cache/budget tables. No key is sent to CardDex.

After a CLI repair, restart the backend and refresh the browser: the existing card-art index cache is process-local. Repaired images are instance files, not repository assets or automatically updated scanner indexes. Do not commit artwork or the metadata ZIP. Provider-reference counts do not include locally cached contributed/fallback art.
