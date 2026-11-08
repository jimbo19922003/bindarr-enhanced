# Reviewed upstream source correction

The upstream revision f1c916b074a107e7232dffdf86368f168262fa97 defines data-asia/BW/BW3b.ts with the ID BW3a, conflicting with its distinct BW3a.ts definition. Compilation applies a single reviewed correction to BW3b in the disposable source copy. The original and corrected Git blob hashes are checked; unrelated source changes require review rather than being patched heuristically. The original checkout and production database are not modified.

The validation report distributed with candidate artifacts includes sourceCorrections alongside upstreamCommit, explicitly identifying the derived build. It is an audit record, not a signature or a claim that unmodified upstream output was used. The existing raw export checksums and conflict checks remain intact.

Correcting this set ID does not supply missing card definitions or artwork. Existing cached or collected BW3a identities may require an ambiguity review before any production cutover; there is no automatic remapping of historical collection references. Remove the correction only after a reviewed upstream replacement and a successful real-bundle build/import test.
