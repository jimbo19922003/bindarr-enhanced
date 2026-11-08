#!/bin/sh
set -eu
: "${BUNDLE_LANGUAGES:?Explicit validated language list required}"
cp -a /source/. /work/
git config --global --add safe.directory /work
bun --version
bun install --frozen-lockfile
cd /work/server
bun install --frozen-lockfile
bun run compile
for language in $BUNDLE_LANGUAGES; do
  test -f "/work/server/generated/$language/cards.json"
  test -f "/work/server/generated/$language/sets.json"
  mkdir -p "/out/$language"
  cp "/work/server/generated/$language/cards.json" "/out/$language/cards.json"
  cp "/work/server/generated/$language/sets.json" "/out/$language/sets.json"
done
cp /work/LICENSE /out/LICENSE
