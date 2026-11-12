<div align="center">

<img src="frontend/public/logo.svg" width="120" height="120" alt="" />

# Bindarr

**Self-hosted collection manager for Pokémon, Magic: The Gathering, and Disney Lorcana cards.**

Identify cards with your phone camera, track prices, record which binder page and slot each card lives in, and pull decks back out again.

[![CI](https://img.shields.io/github/actions/workflow/status/thenotoriousJeremy/bindarr/docker-build.yml?branch=main&label=CI&logo=github)](https://github.com/thenotoriousJeremy/bindarr/actions/workflows/docker-build.yml)
[![Docker image](https://img.shields.io/badge/ghcr.io-bindarr-2496ED?logo=docker&logoColor=white)](https://github.com/thenotoriousJeremy/bindarr/pkgs/container/bindarr)
[![License: MIT](https://img.shields.io/github/license/thenotoriousJeremy/bindarr?color=blue)](LICENSE)
[![Stars](https://img.shields.io/github/stars/thenotoriousJeremy/bindarr?style=flat&logo=github)](https://github.com/thenotoriousJeremy/bindarr/stargazers)
[![Issues](https://img.shields.io/github/issues/thenotoriousJeremy/bindarr)](https://github.com/thenotoriousJeremy/bindarr/issues)

[Live demo](https://thenotoriousjeremy.github.io/bindarr/) · [Install](#install) · [Features](#features) · [How it works](PROJECT.md) · [Report a bug](https://github.com/thenotoriousJeremy/bindarr/issues/new)

</div>

---

https://github.com/user-attachments/assets/4ee6c23f-a024-499b-9fc3-3d144c42ba61

Try it without installing anything at **[thenotoriousjeremy.github.io/bindarr](https://thenotoriousjeremy.github.io/bindarr/)**. The demo runs the real frontend against sample data, so edits aren't saved and scanning is off (it needs a server).

---

## Features

- **Camera scanning** — photograph a card and the server identifies it from the image alone. Works for Magic, Pokémon, and Lorcana.
- **Physical location tracking** — binders by page and slot (1–9), boxes by row and divider, with layout and scalable image-list views. Drag cards between pockets to arrange a binder, or file them by tapping on a phone.
- **Deck Builder & checkout** — build decks, edit their properties, import ManaBox decklists, reserve cards for play, and see exactly which checked-out deck makes a copy unavailable.
- **Search and bulk add** — search or browse a whole set with multi-select; pin a set and add by collector number one keystroke at a time.
- **Set completion and custom sets** — Collection › Sets shows owned and missing cards for any set; tap a missing card to add it, or wishlist every missing card in one go. Build your own sets (a species master set, an illustrator, a rarity across sets) from rules plus hand-picked cards.
- **Collection filters** — find duplicates of the same catalog card across conditions and finishes, or cards with no provider artwork reference and no local artwork. Image links are not checked for availability.
- **Dashboard** — Executive (net worth, total invested, timeline), Sealed (what is still on the shelf), Rip report (opened product against its cost), and Cards (set completion, rarity, type, and where copies live).
- **Sealed product** — a Pokémon catalog and the purchase lots you bought, kept apart from loose cards. Open a unit, record the pulls, and file those cards into the collection.
- **Graded slabs** — record grader, grade and cert number per copy (PSA cert lookup fills them in), and give a slab its own value instead of the raw card's price.
- **Cards in 11 languages** — search, scan and record Japanese, Korean, Chinese, German, French, Spanish, Italian, Portuguese and Russian printings. A copy references the printing it actually is, so it shows the name and artwork on the card while staying searchable by its English name.
- **Exports and API** — CSV (TCGplayer-compatible) or JSON, plus a read-only API key for reading net worth from elsewhere.
- **Multi-user** — session-token auth, admin panel for users and roles, optional public share links.
- **11 UI languages**, community-translated.

Architecture, the scan pipeline, and the data model are in [PROJECT.md](PROJECT.md).

## Collection and deck workflows

### Persistent scan queue

In the scanner settings, enable **Use persistent scan queue** to capture the next
card while earlier captures are matched. The existing scanner remains
the default. Each capture keeps its selected game, language and set filters.
Nothing is added until you review the list and choose **Add selected**. Confident
matches are preselected; uncertain matches require you to select a card. You can
change or clear a selection, search for another card, or remove a capture.
Unselected captures remain for later review. The scanner's auto-add and
confirmation settings do not change this queue behavior.
If two consecutive captures appear to be the same card, scanning pauses and
asks whether to keep another copy or discard the repeated photo. Matching runs
asynchronously, so other captures may already be queued before the warning
appears; they remain available for review. The guard depends on recognizable
matches and cannot catch every repeated photo.

Queue additions record an **unknown purchase cost**, not the market quote; edit
the copy in the collection to enter what you paid. They use Near Mint and the
scanner's default printing. Cached preview prices may be unavailable, and a
price refresh on add is not guaranteed.

The queue is stored in this browser on this device, separately for each account
and server database. Processing runs while the scanner is open and resumes on
return after navigation or reload. Accepted copies are saved individually in the
background, not as one database operation; failure on one does not undo the
others. Failed items can be retried; interrupted saves
reuse a server-side receipt to avoid adding the same copy twice. If a copy was
added but follow-up processing failed, the queue asks you to check the collection.
Do not clear browser site data while captures are pending. Browser storage can be
evicted or run out; a failed capture pauses scanning rather than claiming it was
saved. Queue mode requires IndexedDB, Web Locks and a secure context.

### ManaBox imports

**Decks:** Open **Deck Builder → Create Deck → + Quick Import Decklist**, choose
**ManaBox text export**, then select the `.txt` export. Bindarr reads the
filename as the deck name, uses MTG Commander defaults, and resolves each
printing by its ManaBox set and collector number.

**Storage containers:** In the Storage view, select the upload button beside
**Create Container**, then choose a ManaBox `.txt` export. Bindarr creates a
**Box** named from the file (`Black Box.txt` becomes `Black Box`) and files
matching **Unsorted cards you already own** into its first row. It never adds
new collection cards during a container import; cards absent from Unsorted are
reported as not found.

### Deck Builder

Open a deck and select **Edit Properties** to change its name, description,
format, category, accent color, and target size. A deck's game stays fixed:
its cards are game-scoped.

Deck cards that cannot currently be used have a red warning. The label shows
the missing copy count and, when another checked-out deck holds the copy, that
deck's name — for example, `1 unavailable — Goblin Stampede`.

### Sets and custom sets

Collection › Sets shows every card in a set for the chosen game and language,
with owned cards in colour and missing ones greyed out. Tap an owned card to
open it (several copies open as a stack with the print picker); tap a missing
card to open the **Add this card** drawer for that exact card.

To collect toward a set, use the heart on a missing card to wishlist it, or
**Wishlist N missing** to wishlist every missing card at once (you are asked to
confirm first). Wishlisted cards show a red *Wishlisted* badge, stay counted as
missing, and appear under **Collection → Wishlist**, where the bulk *Move to
collection* action files them once you have them. In a per-printing custom set
each wishlist entry uses the slot's printing; otherwise the card's usual
printing.

**New custom set** builds your own checklist, listed under *Custom sets* in the
same picker. A custom set is:

- **Rules** — card name contains, illustrator contains, in set, rarity is. A card
  must match every rule type you fill in; any entry within a type matches. At
  least a name, illustrator or set rule is needed for rules to match anything.
- **Manual cards** — search and **Include** cards the rules miss; hide a card
  from the grid with its eye button and restore it from the editor.
- **Completion** — *Card* (any copy completes a slot) or *Printing* (each
  printing — Normal, Reverse Holofoil, … — is its own slot, master-set style).

Rules match the cards Bindarr has cached, in the language selected on the
Sets tab; manually included cards show in any language. **Fetch matching cards
from provider** searches for your name rules (up to 5 names, 500 cards each) so
printings nobody has looked up yet are included. Illustrator data is recorded
as cards are cached: TCGdex search results don't carry it, so illustrator rules
see cards once they have been opened, scanned or added, or after the local
Pokémon catalogue is (re)installed. Ownership matches by game, set and
collector number in any language, the same as the standard set view.

### Hiding tabs

Admins can hide optional tabs — Sealed, Sales History, Storage, Deck Builder
and Notes — for every user under **Admin → Instance Settings → Hide tabs**.
Only the navigation button goes away; nothing is deleted, and links from other
views (such as *View in storage*) still open the tab.

### Container views

Containers support layout and image-list views. In image-list view, use the
plus and minus controls to scale card images from 60% to 250%.

---

## Install

### Docker (recommended)

No clone, no build. Create a `docker-compose.yml`:

```yaml
services:
  bindarr:
    image: ghcr.io/thenotoriousjeremy/bindarr:latest
    container_name: bindarr
    restart: unless-stopped
    ports:
      - "3001:3001"   # HTTP  — point a reverse proxy here
      - "3443:3443"   # HTTPS — use this directly if you have no proxy (scanning needs it)
    environment: {}
      # All optional — see the table below.
      # - POKEMON_TCG_API_KEY=       # only if you already have one; pokemontcg.io is deprecated (see below)
      # - POKEMONTCGAPI_KEY=         # only for the optional pokemontcgapi.com provider (see below)
      # - PUBLIC_BASE_URL=
      # - DEFAULT_ADMIN_PASSWORD=
      # - TRUST_PROXY=1
    volumes:
      - bindarr-data:/app/database

volumes:
  bindarr-data:
```

Start it:

```bash
docker compose up -d
```

Open `http://localhost:3001`. The first visit asks you to set a password for the
`admin` account and creates it right there — no password is ever written to the
logs. (If you set `DEFAULT_ADMIN_PASSWORD` instead, that same `admin` account is
created at startup and the first visit is a normal login screen.)

You can change the password later in Settings. Everything (database, backups, scan models and catalogs, TLS cert) lives in the `bindarr-data` volume.

Update with `docker compose pull && docker compose up -d`. Your volume is untouched.

To build from source instead, clone the repo and run `docker compose up -d` — the bundled [`docker-compose.yml`](docker-compose.yml) uses `build:` rather than `image:`.

#### Which port to use

Both ports serve the same app and the same database. Only the transport differs.

| Port | Use it when |
| --- | --- |
| `3001` (HTTP) | You have a reverse proxy (Caddy, NPM, Traefik, Tailscale Serve) terminating TLS in front, or you're on the host itself at `http://localhost:3001`. |
| `3443` (HTTPS) | You have no proxy and want to reach Bindarr from a phone. **Card scanning only works here** — browsers refuse camera access over plain HTTP to anything but `localhost`. |

Publish only the one you use. Behind a proxy, drop the `3443` line and set `TRUST_PROXY=1`.

The HTTPS certificate is self-signed and generated on first start into the volume, so your browser warns once per device (**Advanced → Proceed**; iOS Safari: **Show Details → Visit this website**). Mount a real certificate and set `SSL_CERT_PATH` + `SSL_KEY_PATH` to skip the warning.

#### Image tags

| Tag | Points at |
| --- | --- |
| `latest` | newest release — use this |
| `1.8`, `1.8.8` | a specific release, if you want to control upgrades |
| `edge` | newest `main` commit, including unreleased work |
| `sha-<short>` | one exact commit |

#### Environment variables

All optional.

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port. |
| `HTTPS_PORT` | `3443` in the image | HTTPS port. Set to `""` for HTTP only. |
| `SSL_CERT_PATH` / `SSL_KEY_PATH` | — | Your own certificate instead of the generated self-signed one. |
| `DB_PATH` | `/app/database/bindarr.db` | SQLite file location. |
| `DEFAULT_ADMIN_PASSWORD` | — | Create the `admin` account with this password at startup instead of letting the first browser visit create the owner account. Only applied while the `users` table is empty — changing it later does nothing to an existing account. |
| `POKEMON_TCG_API_KEY` | — | **Only for installs still on the pokemontcg.io provider.** Raises its rate limit from 1,000 to 20,000 requests/day. pokemontcg.io is deprecated: [new registrations are closed](https://dev.pokemontcg.io/) and existing keys stop working on **1 March 2027**. New installs default to TCGdex, which needs no key — leave this unset. |
| `POKEMONTCGAPI_KEY` | unset | Server-side key for the optional [pokemontcgapi.com provider](#pokemon-data-providers). Setting a key alone does not enable it. |
| `POKEWALLET_API_KEY` | unset | Server-side key for PokéWallet price lookups, including fallback when CardDex cannot price a supported card. Card IDs are not changed. The key is never returned to the browser. |
| `CARDDEX_API_KEY` | unset | Optional server-side CardDex key; public reads work without one. A key saved in Settings takes precedence. |
| `PUBLIC_BASE_URL` | — | External URL behind a proxy, e.g. `https://cards.example.com`. Used for share links and auto-allowed as a CORS origin, so proxied logins work with just this. Also editable in the Admin panel. |
| `PORTFOLIO_TIMEZONE` | `America/Chicago` | IANA timezone for daily portfolio snapshots and sale accounting. An admin's saved portfolio timezone takes precedence. Existing snapshots remain in their original timezone and are only shown when that timezone is selected; missing days are not reconstructed. |
| `PORTFOLIO_SAMPLE_MINUTES` | `15` | Interval between portfolio samples while the server is running (1–1440 minutes); a sample also runs at startup. |
| `CORS_ORIGIN` | — | Extra allowed origins, comma-separated. Localhost and private-LAN origins are always allowed. |
| `ALLOW_REGISTRATION` | unset | `true` allows self-registration. Unset means invite-only: admins create accounts. |
| `OIDC_ENABLED` | `false` | Set to `true` to enable OpenID Connect / SSO login (Authelia, Authentik, Keycloak, etc.). |
| `OIDC_ISSUER_URL` | — | Base URL of the OIDC provider (e.g. `https://auth.example.com`). **Must be `https`** — `http` is accepted only for `localhost`/`127.0.0.1`. Bindarr accepts the ID token on the strength of the TLS connection it arrives over rather than verifying its signature (permitted for the authorization-code flow by [OIDC Core §3.1.3.7](https://openid.net/specs/openid-connect-core-1_0.html#IDTokenValidation)), so plain HTTP would leave the identity unauthenticated. The discovery document's own `issuer` must also match this value. |
| `OIDC_CLIENT_ID` | — | OIDC OAuth2 client ID. |
| `OIDC_CLIENT_SECRET` | — | OIDC OAuth2 client secret. |
| `OIDC_PROVIDER_NAME` | `Single Sign-On` | Display name shown on the login button (e.g. `Authelia`, `Authentik`, `Keycloak`). |
| `OIDC_USER_CLAIM` | `preferred_username` | Identity claim to map to the Bindarr username. |
| `OIDC_AUTO_PROVISION` | `true` | Automatically create a Bindarr member account on first successful SSO login. |
| `OIDC_ALLOW_USERNAME_LINK` | `false` | Let an SSO identity attach itself to an **existing** Bindarr account that has the same username. Needed to move accounts created before SSO onto it. **Only turn this on if your users cannot choose their own username at the identity provider** — if they can, someone setting theirs to `admin` takes the owner account on their first login. With it off, an SSO login whose username is already taken is refused rather than silently given a second, empty account. |
| `OIDC_TOKEN_ENDPOINT_AUTH_METHOD` | `client_secret_basic` | Token endpoint client authentication method. Set to client_secret_basic or client_secret_post. |
| `NODE_EXTRA_CA_CERTS` | — | PEM file of a private root CA to trust, for an identity provider whose certificate it signed. See [SSO with a private CA](#sso-with-a-private-ca). |
| `TRUST_PROXY` | — | Number of proxy hops (usually `1`) when a reverse proxy terminates TLS, so rate limiting sees the real client IP. |
| `CV_MODEL_DIR` | `/app/database/models` in the image | Where the scan models and catalogs live. Must be on persistent storage, or an image update discards every catalog you built. |
| `CV_SCAN_GAP` | `0.10` | How far a match must stand above its runner-ups before it counts as an answer rather than "this card is not in the catalog". Lower accepts more guesses. |
| `BACKUP_INTERVAL_HOURS` | `24` | Automatic database snapshot interval. `0` disables. |
| `BACKUP_KEEP_LAST` | `10` | How many snapshots to retain. |

#### SSO with a private CA

Register `<PUBLIC_BASE_URL>/api/auth/oidc/callback` as the redirect URI at your identity provider (e.g. `https://cards.example.com/api/auth/oidc/callback`). Without `PUBLIC_BASE_URL` it is built from the request's host; `OIDC_REDIRECT_URI` overrides it outright.

The Android and iOS apps use that same redirect URI: SSO opens in the system browser, and the server's callback hands the login back to the app through the `bindarr://oidc` link with a one-time code. There is no extra redirect URI to register at the provider.

If the provider's certificate is signed by your own root CA, SSO login fails with `fetch failed` and the container log names a certificate error such as `UNABLE_TO_VERIFY_LEAF_SIGNATURE` or `SELF_SIGNED_CERT_IN_CHAIN`. Node ships its own CA list and does not read the operating system's certificate store, so adding the CA to the container's system store does not help. Mount the CA's PEM file and point `NODE_EXTRA_CA_CERTS` at it:

```yaml
    environment:
      - NODE_EXTRA_CA_CERTS=/certs/root-ca.pem
    volumes:
      - bindarr-data:/app/database
      - ./root-ca.pem:/certs/root-ca.pem:ro
```

Node reads this variable once at startup, so set it in the container or process environment. A `.env` file read by the server does not work for it.

`GET /api/health` returns `200 {"status":"ok"}` with no auth and backs the image's `HEALTHCHECK`.

### Prebuilt server binary

If you'd rather not run Docker, every release ships a self-contained server. Download it from the [latest release](https://github.com/thenotoriousJeremy/bindarr/releases/latest), unpack, run, then open `http://localhost:3001`.

| OS | File | Run |
|----|------|-----|
| Windows | `Bindarr-Server-windows-x64.zip` | unzip, double-click `bindarr-server.exe` |
| Linux | `Bindarr-Server-linux-x64.tar.gz` | `tar xzf`, then `chmod +x bindarr-server && ./bindarr-server` |
| macOS (Apple Silicon) | `Bindarr-Server-macos-arm64.tar.gz` | `tar xzf`, then `chmod +x bindarr-server && ./bindarr-server` |

The first visit in a browser asks you to create the owner account. The SQLite file is created next to the binary. To set variables from the table above, create `app/backend/.env` before the first run — HTTPS is off by default here, so add `HTTPS_PORT=3443` if you want to scan from a phone.

### Mobile apps

`Bindarr-Android.apk` is attached to each release (allow "install from unknown sources"). iOS goes out through TestFlight. Both talk to a Bindarr server, so install one of the above first and point the app at it.

If your server's certificate comes from your own (private) CA, install that CA certificate on the phone first:

- **Android:** Settings → Security → Encryption & credentials → Install a certificate → CA certificate. The app trusts user-installed CAs.
- **iOS:** install the CA profile, then turn on full trust for it under Settings → General → About → Certificate Trust Settings.

---

## Pokémon data providers

Choose the Pokémon provider under **Admin → Instance Settings**. New installs
still use TCGdex, and upgrades keep the provider already configured.

| Provider | Printings served | Key |
| --- | --- | --- |
| TCGdex | All existing Pokémon language choices, subject to its catalogue coverage | None |
| pokemontcg.io (deprecated) | English; other languages use TCGdex | Optional `POKEMON_TCG_API_KEY`. Registrations are closed and keys stop working on 1 March 2027; an install still on it gets a warning in the server log at every boot |
| pokemontcgapi.com (optional) | English, Japanese and Simplified Chinese; other languages use TCGdex | Required `POKEMONTCGAPI_KEY` |

To enable pokemontcgapi.com, set `POKEMONTCGAPI_KEY` in the **backend server's**
environment and restart it, then select **pokemontcgapi.com** and save in the
Admin panel. For Docker, add `POKEMONTCGAPI_KEY: ${POKEMONTCGAPI_KEY}` under the
service's `environment` mapping. This key is separate from the pokemontcg.io key
in personal Settings and is never returned to the browser. Setting the key alone leaves the
provider disabled.

The optional provider supports set browsing, name and collector-number searches,
card lookup, artwork, and caching cards for local scan catalogs. Japanese and
Simplified Chinese searches use their own physical release lines, not translated
Western sets. The API can fall back to English names, and Chinese printed names
are not currently supplied. Traditional Chinese and all other existing language
choices continue through TCGdex.

Prices prefer an ungraded Cardmarket quote in EUR, then TCGplayer in USD, for the
printing's language. Printing-specific columns always use the same source and
currency as the representative price. The inspector names the source; there is
no currency conversion. Unavailable or plan-withheld prices remain absent,
including the currently unpriced Simplified Chinese catalogue. TCGCSV continues
to price existing providers' cards, but does not overwrite these quotes.

Requests use up to 250 cards per page, cursor pagination, a persistent response
cache and conditional ETag requests. Normalized cards also live in `card_cache`.

The API meters credits, and prices are what cost them: a 250-card page is one
credit without prices and about forty with them (measured 10 Sep 2026). So
browsing and searching fetch names and artwork only, and a card is priced at the
two moments the app shows a value: when it enters your collection (two credits for
that card) and in the automatic refresh of owned or decked cards (batched, about
one credit per six cards). That refresh only asks about cards whose stored price
is older than three days, and it runs as often as **Admin → Instance Settings →
Refresh prices** says: daily by default, down to every 30 days or never (see
[How often prices refresh](#how-often-prices-refresh)). Search results therefore
show no price until a card is added. A full catalogue build of a language costs roughly one credit per 250
cards (Japanese, the largest release line, is under 100 credits), so check the
account's quota before building a whole language. An outage serves matching
cached cards or reports an error; it does not silently switch ID namespaces.

Switching provider keeps existing collection entries and their IDs. Existing scan
catalogs remain usable; rebuild the relevant language catalog to include the new
provider's cards. This is an alternative an admin can select when another provider
is unavailable, not automatic failover or a migration of existing cards.

API contract and coverage: [documentation](https://pokemontcgapi.com/docs),
[OpenAPI](https://pokemontcgapi.com/openapi.json),
[regional coverage](https://pokemontcgapi.com/coverage).

For English `tcgdex-en-` Pokémon card IDs, owned and decked cards use CardDex
first and then PokéWallet when CardDex cannot provide a confirmed, fresh base
printing price. Existing positive quotes are retained when both fail. If the
current price is empty, the latest compatible positive recorded or cached
history point is restored when available; otherwise the card remains unpriced.
Current quotes keep their source and currency.
Only confirmed base finishes are written; other editions and languages can
remain unpriced or rely on their retained compatibility paths. CardDex history
for an owned card is fetched on demand and cached as a replaceable provider
response; existing local history is not deleted. CardDex publishes at most
365 days of history through this endpoint.

CardDex and artwork requests share a conservative budget of 25 requests per
minute and 4,500 per rolling day, and respect cooldowns. Automatic pricing
handles at most 25 cards per hourly tick and follows the admin refresh interval.
These limits also apply when no CardDex key is configured. Data by
[CardDex](https://carddex.dev); prices name Cardmarket or TCGplayer.

PokéWallet is a separate price lookup, not another catalogue. Set
`POKEWALLET_API_KEY` on the server and restart, then use **Admin → PokéWallet
prices**. It can fill an English TCGdex card that still has no positive price
when the set, collector number, and name agree and the product is a single.
The lookup sends the card name and set code. PokéWallet does not search by
a name plus a collector number; the number is checked on the results. An
empty set search may be followed by one name-only search for that same card.
Anything uncertain is listed for confirmation and does not change a price.
Requests stay inside the key's hourly and daily allowance, and one pass
asks for at most 25 cards. An admin can save the key in Admin or Settings;
a saved key is used instead of `POKEWALLET_API_KEY`.

## Sealed inventory

Sealed products are a catalog, separate from the purchase lots that record
what you actually bought. The same product can have several lots, each with
its own quantity, purchase date, currency, and total cost in integer cents.
The current market quote is stored on the product and does not overwrite the
cost. A missing quote is unknown, not zero. Archive hides a product or a lot
from the portfolio without deleting it.

Remaining cost is the share of the original total still sealed. Integer
division leaves the leftover cent on the units that are still there, so the
cents add back to the original total. Costs in different currencies are not
converted.

The dashboard net worth includes the known market value of units still sealed.
Total invested is what you paid for loose cards plus the original cost of every
sealed lot, including units you have already opened. Opening a box leaves that
cost in the total. The Sealed tab's cost still sealed is the share still on the shelf, and it
falls as units are opened. The set chart
adds sealed market value onto the set with the same name. Top sealed products
are listed beside top cards. A sealed unit is not counted as a card. Import and export use CSV from
the Collection side of the Sealed tab. A location name in the file must
already exist for that user.

Add and Collection are separate tabs. A search returns sealed products only.
Click a product to open the add dialog, then enter that lot's quantity and
cost. The results stay on screen, so the next product does not search again.
The picture is
TCGplayer's public product image for the id PokéWallet already returned. The
search needs the PokéWallet key saved in Settings. A missing market price
stays unknown. A product the search does not list is still entered by hand.

Each purchase lot has its own LET IT RIP. That opens rapid add with the
product's set already filled in: type a card number and press Enter to record
the pull. The opening keeps the share of the lot
cost allocated to it. Pulls recorded on it have their own current value, and
an optional value from the day it was opened. A blank price is missing, not
zero. The difference between known current value and opening cost is an
estimate of unrealized value, not realized profit. Amounts in another
currency are not converted. A bulk line can record one quantity and one total
instead of every card. If a per-card cost is wanted later, the opening cost
is split by quantity across the pulls, with the leftover cent on the last
pull, and it is not copied onto every pull or onto a collection purchase
price. Removing an opening puts that unit and its cost back on the lot and
removes the collection copies that opening added. A card you already owned,
and only linked to the pull, stays.

Adding a Pokémon card prices it from PokéWallet when the catalog has no
market price, so the copy is not stored as zero. The card list, pictures, and
set names still come from the card catalog. One extra PokéWallet search fills
prices on that result page when a key is saved. Magic and Lorcana are unchanged.

## Dashboard

The dashboard has four tabs. The game filter at the top applies to each of
them, and amounts in different currencies stay in the currency they were
quoted in.

**Executive** is the portfolio: net worth, recorded lifetime spending,
estimated unrealized gain, realized gain, and the value timeline. Net worth
includes cards plus the market value of sealed units still on hand. Estimated
unrealized gain is net worth minus recorded lifetime spending plus the
acquisition cost of completed sales. Sale proceeds less fees and sold cost
are reported separately as realized gain. Sold items leave net worth.
Missing purchase costs and market prices contribute zero. When sold cost is
unknown, no cost is removed for that sale, and the unrealized amount is
marked as an estimate; its cost may already be included in spending. The
realized amount shows only the known subtotal and excludes that sale; total
gain remains unknown. Spending includes archived and otherwise
removed purchases, so this estimate can differ from the actual gain on
currently owned items. Historical spending may also be incomplete. New
timeline points use this calculation; older points retain their original basis.
The estimated loss/gain percentage divides total estimated gain by recorded
purchase spending, not by a cash-flow-adjusted investment amount. It is
unavailable when spending is zero or total gain is unknown. The S&P 500 view
compares portfolio value change with the index price change, excluding dividends;
purchases, sales and removals affect portfolio value and it is not an investment
return comparison. Portfolio day change compares the current value to the most
recent snapshot from an earlier calendar day in the portfolio timezone, which
may not be yesterday. It includes holdings changes as well as price changes,
and converts the earlier USD snapshot using current exchange rates.

**Sealed** is what is still on the shelf: units, market value, cost still
sealed, and that value against the remaining cost. Opened units leave this
tab. Their results are on the Rip report.

When adding a card manually or recording a new rip pull, choose its printing.
Where TCGdex supplies verified availability, the picker only offers those
printings; otherwise it warns that the choices are unverified. Older local
catalogues acquire this metadata when re-imported or their sets are synced.
New rip pulls use the selected printing's quote, converted to the opening
currency. When the provider has no quote for that printing (often Reverse
Holofoil), the line says so and the pull is valued from the card's general
market price as an estimate. **Value each** on a new line overrides either
figure; leave it blank to use the market price. Existing recorded pulls are
not changed.

Each card added to a rip gets its own line, so two copies of the same card
can be recorded as different printings. A line typed up to a larger quantity
has **Split into single lines**. A rip holds at most 100 lines.

Saving a rip files and prices every card, which can take a while. The drawer
shows a running timer, and **Stop waiting** appears after 15 seconds. The
request is abandoned after 3 minutes. A stopped or timed-out save may still
finish on the server, so check the openings list before saving again. A
price refresh that takes longer than 10 seconds while a card is filed does
not hold up the save. The card is filed with its cached price, and the
refresh finishes in the background.

**Rip report** compares the known value of pulls with what the opened units
cost. Missing prices are left out of the value. The set chart ranks that gap
as a percentage of what the set cost, so a larger purchase is judged by the
same measure as a smaller one. 0% is even with cost. Green is ahead and red
is behind. A **$ / %** switch shows the same ranking in money, and best and
worst follow the measure that is on. The table's Recovery column is the
share of cost the known pulls cover, so 100% there is even.

**Cards** is the collection: set completion, rarity, type or color,
condition, extra copies, and which containers hold the cards. Extra copies are
grouped by card ID across all collection entries. Their estimated market value
keeps the highest-valued copy of each card and totals the remaining copies;
copies without a market price contribute zero.

Set-value charts combine card and sealed set names within each game when they
match after Unicode, whitespace, and case normalization, even if their source
set IDs differ. Identically named but unrelated sets in the same game therefore
share a value bar. Set completion remains separate by game and set ID. If one ID
has conflicting names, those names remain separate and the server logs a warning.

## Card scanning

Scanning is image-only — no OCR, no typing. Two things have to be in place, and
neither ships inside the app:

**1. The models.** Two small neural networks (~9.6 MB together) find the card in
the frame and turn its artwork into a fingerprint. They are AGPL-3.0 while Bindarr
is MIT, so they are fetched deliberately rather than bundled:

```bash
docker exec bindarr node scripts/fetch-models.mjs
```

(Running from source or the prebuilt binary: `node scripts/fetch-models.mjs` in
`backend/`.) Restart afterwards. Until they are there, the server says so at
startup and scanning returns a clear error instead of guesses.

**2. A catalog.** The fingerprint has to be compared against something. Build one
per game and language from **Admin → Catalogs**: it downloads that game's card
list and fingerprints every card's artwork — hours for a full English game, and
about 5 MB of output per 10,000 cards. Progress is live, stopping keeps what it
has, and resuming reuses it. `--catalogs` on the fetch command above grabs
prebuilt English Magic and Pokémon catalogs instead, which answer immediately but
only resolve cards your install has already seen.

Scanning is then the same whether or not you tell it which set you are feeding.
Naming the set just restricts the comparison to that set's cards, which is faster
and more accurate, and needs no preparation.

Coverage is only as good as the card data available for a language: the panel shows
what a catalog holds against what the provider claims exists, e.g. *3,297 of
16,192* for Japanese Pokémon, where the upstream data simply stops. A card outside
the catalog is reported as missing rather than guessed at, with the nearest matches
offered underneath.

The pipeline, its accuracy numbers, and the measurement harness are documented in
[PROJECT.md](PROJECT.md#image-identification-pipeline).

---

## Card values

Every price source Bindarr talks to — TCGplayer, Scryfall, Cardmarket — quotes the **raw** card. A PSA 10 sells for a multiple of that, so a graded copy needs its own number, and each copy can carry one: open the card, edit it, and set **Value for this copy**. That value replaces the market price everywhere — net worth, set totals, sorting by price, exports. Clear the field to go back to the card's own price.

For Pokémon slabs it can also be fetched. Put a [PokemonPriceTracker](https://www.pokemonpricetracker.com/api) key in **Settings → API Keys** and a **Fetch graded price** button appears on graded copies. It fills in what that card sells for on eBay at that grade — PSA, BGS or CGC, half grades included — and says how many sales the figure rests on. If the grade has no recorded sales it tells you which grades do, rather than guessing.

One card per press, never a background sweep: each lookup spends 2 of the free tier's 100 daily credits, and a sweep over a collection would spend a week's worth on one boot. Magic slabs have no source, so they stay hand-entered.

With **Stack** on, the card view for a stack that holds more than one copy shows a button per printing with its count (for example *Normal ×2*, *Reverse Holofoil ×1*), and one per copy when a printing has several. Edit, delete and **Sell this copy** act on the copy you picked.

The price-history chart follows the price shown above it. A copy whose printing has its own price, such as a Reverse Holofoil, charts that printing's series. Bindarr records it whenever the price changes, starting with this release, so a new series needs one recorded change before it draws a line. Other copies chart the card's general price. After an English Pokémon card moves from CardDex to the TCGCSV mirror, its chart still includes the CardDex history already cached in the same currency. The S&P 500 comparison on the dashboard uses daily portfolio snapshots, not card history, and needs at least two days of them.

### Cards in other languages

Which marketplace can price a printing depends on where it is sold, so the source follows the card:

| Card | Priced from |
| --- | --- |
| Magic, any language | Scryfall — TCGplayer's USD price, or Cardmarket's EUR one when TCGplayer has no listing (most non-English printings). **Admin → Instance Settings → Magic price source** flips this to Cardmarket EUR first, TCGplayer USD as the fallback |
| Pokémon via pokemontcgapi.com | Cardmarket EUR when available, otherwise TCGplayer USD, for the printing's language |
| Pokémon English TCGdex IDs | TCGCSV via the shared mirror, then CardDex, then PokéWallet; previously cached price on failure |
| Pokémon via other existing providers, English or Japanese | TCGplayer, via TCGCSV, in USD |
| Pokémon via existing providers, other languages | the **English** printing's TCGplayer price, labelled as such — TCGplayer runs no German, Korean or Chinese catalogue |

Prices retain their original quote currency and marketplace. Displays and portfolio totals convert them to the selected currency using cached exchange rates; when rates are unavailable, conversion is shown as unavailable rather than mixing currencies. A fresh quote in a different currency can replace the previous quote; finish prices not provided in the new currency are cleared rather than relabelled.

A price only exists once something fetched it. The Pokémon price sweep covers the sets you own cards from, so browsing a set you own nothing in shows `0.00` until a card from it lands in your collection.

The PokéWallet pricing-issues list shows unpriced cards still in a collection or
deck, in pages of ten. An earlier matching failure no longer appears while any
source provides a positive card price; its mapping history is retained and the
issue can reappear if that price is later removed.

### How often prices refresh

Owned and decked cards have their prices re-fetched automatically. **Admin → Instance Settings → Refresh prices** sets how often that runs: daily (the default), every 3 days, weekly, every 30 days, or never. CardDex processes up to 25 due cards per hourly tick; unsuccessful attempts can retry on a subsequent tick. Legacy providers have their own freshness gates.

Daily is what the free providers publish, so leave it there unless you have a reason. Turn it down if you are on a provider that charges per card refreshed, or if you have a very large collection and only look at its value occasionally. **Never** stops automatic refreshes entirely; prices already stored stay as they are.

### TCGCSV data sync

Bindarr downloads TCGCSV data from the shared mirror and stores it in the local SQLite database; app and catalog operations use that cache instead of fetching data for each request. At startup and during scheduled work, Bindarr checks TCGCSV's `last-updated.txt` no more than once every 24 hours and only downloads a new dataset when the timestamp advances. A new dataset is staged until the full sync succeeds, so the last complete cache remains available for catalog operations if a refresh fails. When the mirror refresh fails, price refreshes use fallback sources instead. Only the Pokémon categories (3 and 85) are synced, about 1 + 2 + 2 × (number of sets) requests per new dataset, and only the fields Bindarr reads are stored. A set that TCGCSV answers with a 404 or an error is recorded as empty rather than blocking the sync; a dataset that still has not completed after 24 hours is abandoned and `last-updated.txt` is checked again.

Outbound requests are serialized and spaced by at least 100 ms. If TCGCSV returns HTTP 403, Bindarr logs the response and pauses further TCGCSV requests for 24 hours.

To route all Bindarr TCGCSV traffic through a reverse-proxy/read-through cache, set the server-side `TCGCSV_BASE_URL` environment variable to its base URL (for example, `http://tcgcsv-cache:8080`). The cache must serve `last-updated.txt` and the `/tcgplayer/...` endpoints. This setting covers sync, catalog, and price-refresh requests; it defaults to the upstream shared mirror. Configure it in the server's environment or Docker Compose, not in the browser app. Do not point it at tcgcsv.com.

### TCGCSV mirror

Pokémon TCGplayer prices come from [TCGCSV](https://tcgcsv.com), a free service run by one person. The upstream project publishes a shared copy so individual installs do not contact TCGCSV directly. Bindarr defaults to:

```sh
TCGCSV_BASE_URL=https://raw.githubusercontent.com/thenotoriousJeremy/bindarr/tcgcsv-mirror
```

Existing installations with an explicit `TCGCSV_BASE_URL` keep that override and should remove it or set it to the shared mirror. The local mirror sync script and workflow are `scripts/tcgcsv-mirror/sync.mjs` and `.github/workflows/tcgcsv-mirror.yml`.

## API access

For reading your collection from somewhere else — a finance tracker, a dashboard widget, a script — generate a key under **Settings → API Keys** and send it as a Bearer token:

```bash
curl -H "Authorization: Bearer <key>" http://localhost:3001/api/stats/networth
```

```json
{ "totalValue": 4210.55, "totalSpent": 2980.00, "gain": 1230.55, "gainPct": 41.3,
  "totalCards": 812, "uniqueEntries": 604,
  "byGame": { "pokemon": { "cards": 500, "value": 3100.20 }, "mtg": { "cards": 312, "value": 1110.35 } },
  "currencies": ["USD"], "asOf": "2026-08-17T17:55:40.898Z" }
```

The key never expires and is **read-only**: any request that is not a GET is refused, and admin endpoints are refused outright. Add `?game=pokemon` to scope the figures. `/api/stats` returns the full dashboard payload if you want the breakdowns too, and `/api/collection` returns every card. More than one entry in `currencies` means providers quoted in different currencies and the total sums them as-is.

Revoking is one click in the same panel; anything using the old key stops immediately.

## Arranging a binder

A container set to **Custom** order files by hand rather than by a sort scheme. Drag a card from the Unsorted queue into a pocket to file it, drag a filed card to another pocket to move it (drop it on an occupied pocket and the two swap), and drag one back to the Unsorted queue to take it out of the binder.

Dragging is mouse-only — on a phone a drag would fight the page-swipe, so touch files by tapping instead: turn on **Arrange**, tap the card, tap the pocket. Both routes go through the same placement rules, so a locked or full container refuses either way.

## Backup and restore

Everything is in one SQLite file (`DB_PATH`, in the `bindarr-data` volume under Docker).

Bindarr snapshots the database itself every 24 hours into a `backups/` folder beside it, keeping the last 10. That runs while the server is live and needs no downtime.

For an off-box copy, stop the container first so the WAL is checkpointed:

```bash
docker run --rm -v bindarr-data:/data -v "$PWD":/backup alpine cp /data/bindarr.db /backup/
```

Restore by dropping the file back into the volume with the container stopped. Individual users can also export and re-import their own collection as CSV or JSON from the app.

**Lost the admin password?** There's no self-service reset, and `DEFAULT_ADMIN_PASSWORD` will not change an existing account — it is only used when no accounts exist. Delete the database file to start fresh and create the owner account again.

> **Upgrading from before v1.5.0:** the database file was renamed `pokemon_cards.db` → `bindarr.db`. First start renames it automatically, sidecars included. Old `pokemon_cards.*.bak` backups still restore.

---

## Development

Node 18+ and npm 9+.

### GitHub Codespaces

Create the Codespace from a branch that contains `.devcontainer/` (the pull
request branch). The editor opens when dependency setup finishes, and a terminal then stays
attached to the app. Refresh port **3001** (**Bindarr test instance**) after
that terminal says the server is running. A 502 on the forwarded host means
the server is not listening yet. A Codespace created from `main` has no dev container: the file
list has no `.devcontainer` folder, no server starts, and the Ports panel
stays empty. Switching branches in that Codespace does not fix it until
**Codespaces: Rebuild Container**, or until you create a new Codespace from
this branch. If the window stays on "Opening remote...", stop that Codespace
at https://github.com/codespaces and create a new one from this branch.
Details: [docs/CODESPACES.md](docs/CODESPACES.md).

```bash
npm run install:all
npm run dev
```

Frontend at `https://localhost:5173` (self-signed HTTPS, so the camera works), backend at `http://localhost:3001`.

To test scanning from a phone, put it on the same Wi-Fi and open `https://<your-computer-ip>:5173`, then accept the certificate warning (**Advanced → Proceed**).

Tests: `npm test`. Frontend lint (matches CI, fails on any warning): `cd frontend && npm run lint`. Code layout and conventions: [PROJECT.md](PROJECT.md).

---

## Translating

Bindarr speaks English, Brazilian Portuguese, French, German, Italian, Japanese, Korean, Russian, Simplified Chinese, Traditional Chinese and Spanish. More are welcome, and it doesn't require writing code: copy [`frontend/src/locales/en.json`](frontend/src/locales/en.json), translate the text after each `:`, open a pull request. Partial files are fine — anything missing falls back to English key by key.

Details, including placeholder and plural rules, in [docs/TRANSLATING.md](docs/TRANSLATING.md).

This is the language of the *app*. The language a card was printed in is a separate per-card field.

---

## License

[MIT](LICENSE).
