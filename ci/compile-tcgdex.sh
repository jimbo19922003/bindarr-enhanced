#!/bin/sh
set -eu
: "${BUNDLE_LANGUAGES:?Explicit validated language list required}"
mkdir -p /work/source
cp -R /source/. /work/source/
cd /work/source
git config --global --add safe.directory /work/source
bun /opt/bindarr/apply-catalog-corrections.js /work/source /out
bun --version
bun install --frozen-lockfile
cd /work/source/server
bun install --frozen-lockfile
bun run compile
for language in $BUNDLE_LANGUAGES; do
  test -f "/work/source/server/generated/$language/cards.json"
  test -f "/work/source/server/generated/$language/sets.json"
  mkdir -p "/out/$language"
  cp "/work/source/server/generated/$language/cards.json" "/out/$language/cards.json"
  cp "/work/source/server/generated/$language/sets.json" "/out/$language/sets.json"
done
cp /work/source/LICENSE /out/LICENSE
