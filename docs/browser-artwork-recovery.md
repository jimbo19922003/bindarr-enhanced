# Browser artwork recovery

When local preview is enabled, an administrator viewing an English TCGdex card with no provider image reference and no known local artwork can start background repair through the card image component. This is not a metadata import or provider switch. It can consume external-provider allowance. Existing artwork is retained. Broken nonempty provider URLs and non-English artwork are outside this increment.

The new /api/card-art/repair/:cardId POST and GET routes sit behind the existing authentication/admin gate and repeat the role check. They accept no image URL, credential or replacement image from the browser. Public visitors and members cannot trigger provider traffic; they can continue to view already cached art through the existing public image path.

Card identity comes from the active English snapshot. Two jobs per server process are allowed; duplicate requests for a card share the in-process job. Provider quotas/cooldowns remain persistent. Failed results are cached in a separate job table for a minute for transient failures or a day for coverage/ambiguity failures. This is not cross-process job deduplication.

The job tries CardDex and then PokéWallet. The browser path validates/decodes and saves bytes inside the ordered attempt, so invalid CardDex image bytes can advance to the emergency provider. Changed card identity and local-storage errors stop the chain. Successful repair updates the browser artwork index immediately and uses a versioned local image URL; no terminal command or backend restart is required for these in-app repairs.

The client shares jobs across repeated card instances, limits concurrent polling to two, bounds queued work to 64 and caches outcomes. Polling is finite; jobs can continue after a browser closes. A busy/timeout result may require reopening the card view later. Source coverage is not guaranteed, and neither metadata nor reference counts establish scanner readiness. Artwork files remain local instance data; no card IDs, prices, purchases or collection rows are changed.

CI applies guarded repeat-safe wiring, exercises service/auth/client/provider-order/image tests, runs backend tests and frontend lint/tests/build, and commits only the three wiring files after success. This commit does not itself contact live providers or use a real credential.
