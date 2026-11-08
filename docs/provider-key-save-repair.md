# Provider key persistence repair

This repair decouples the PokéWallet emergency-backup key from personal API key settings and the full pricing-status endpoint. It does not implement CardDex or change provider precedence. Local catalogue, then CardDex, then PokéWallet remains the intended order; the artwork CLI remains a separate unfinished integration.

The new settings subrouter inherits authentication from the existing API gate and checks administrator role itself. Its PUT validates a nonempty key, updates the existing app_settings row within a transaction, reads back the exact value before commit, and reports success only after commit. Its GET returns configuration flags, never key contents. Storage failures return 503, not a misleading unconfigured response. Blank saves cannot erase a key. Existing explicit clearing through the old settings endpoint is unchanged.

The frontend no longer requires a successful initial status request to attempt a key save. It writes the emergency key independently, verifies database-backed status, and sends personal settings only when they changed. Partial success is explicit. Neither initial status nor success/error messages expose the saved key. The UI status check does not validate the key with PokéWallet or consume provider requests.

A guarded, repeat-safe integration script refuses to overwrite changed source files. CI applies the wiring in its checkout, runs focused HTTP/frontend-helper tests, full backend tests and frontend lint/tests/build, then commits only the two wiring files if validation succeeds. No real instance credential is included in tests, no collection data is changed by this commit, and no external provider is contacted during key saving.
