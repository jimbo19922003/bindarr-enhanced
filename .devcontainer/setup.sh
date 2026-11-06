#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
major="$(node -p "process.versions.node.split('.')[0]")"
if [ "$major" != "20" ]; then
  echo "This dev container expects Node 20 (found $(node -v)). devcontainer.json pins mcr.microsoft.com/devcontainers/javascript-node:1-20-bookworm." >&2
  exit 1
fi
mkdir -p .devcontainer/data
npm ci
npm ci --prefix backend
npm ci --prefix frontend
npm run build:frontend
node backend/test/openingAccounting.test.js
printf '\nSetup complete. Run: bash .devcontainer/start.sh\n'
