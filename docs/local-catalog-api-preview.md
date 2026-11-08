# Local catalog API preview

Set POKEMON_LOCAL_CATALOG=1 on a test instance to serve authenticated GET /api/sets?game=pokemon&lang=en (or another explicitly synchronized language) from the active local catalog snapshot. The handler stays behind the existing authentication gate. It does not fetch metadata or fall back to a public catalog service. No language snapshot returns HTTP 503 with LOCAL_CATALOG_SYNC_REQUIRED; an invalid explicit language returns HTTP 400. The flag is off unless explicitly enabled.

The response remains a bare set array. `total` counts actual imported physical card records for that set, while `printed_total` retains the upstream official count; these are deliberately distinct. Set artwork and PTCGO codes are empty because the current local snapshot schema does not preserve those fields. This is not a claim of full provider feature parity.

This increment wires set listings only. Unspecified-game requests, other games, exchange rates and existing legacy behavior with the flag off are unchanged. Search, card details, scan hydration, automatic bundle retrieval, Admin controls and full Pokemon-only cutover still require integration. Do not enable this preview on production as a completed migration. No production import or deployment is part of this commit.
