# Artwork repair diagnostics

Backend logs prefixed [artwork-repair-route] show route readiness and blocked/failed requests. Logs prefixed [artwork-repair] show the card ID, random per-job ID, queueing, provider lookup/download outcomes, validation/storage errors, completion, and cached failures with retry times. Final job-record failures are explicitly logged rather than silently discarded.

Logs never include API keys, headers, raw Axios errors, provider response bodies, arbitrary URLs or image bytes. Error codes and provider statuses are allowlisted. Browser logs prefixed [artwork-repair-client] distinguish an absent/blocked HTTP request from provider-chain exhaustion, preserve safe provider reasons and bound polling. The client resolves the current fetch wrapper at request time.

These diagnostics do not change provider priority, limits, negative-cache expiry or collection data and do not force a live retry. A cached unavailable result is logged with its existing attempts and retry time. The TCGCSV price cooldown and scanner readiness messages are separate from these artwork jobs; neither diagnoses an artwork failure by itself. This adds observability, not proof of provider coverage.
