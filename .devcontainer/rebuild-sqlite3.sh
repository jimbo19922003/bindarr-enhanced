#!/usr/bin/env bash
# The sqlite3 npm prebuild is linked against GLIBC_2.38. Debian Bookworm, which
# is the Codespace image and node:20-slim, only has glibc 2.36. Loading that
# prebuild throws ERR_DLOPEN_FAILED and the server never listens. The production
# Dockerfile rebuilds this one module from source for the same reason. sharp
# keeps its prebuilt binary; it cannot build here without libvips-dev.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -d backend/node_modules/sqlite3 ]; then
  echo "Backend dependencies are not installed. From the repository root run: bash .devcontainer/setup.sh" >&2
  exit 1
fi

if ( cd backend && node -e "require('sqlite3')" ) >/dev/null 2>&1; then
  exit 0
fi

echo "The sqlite3 prebuild needs GLIBC_2.38, which this system does not have."
echo "Rebuilding sqlite3 from source so it links against this system's glibc. This can take a few minutes."

if ! command -v g++ >/dev/null 2>&1 || ! command -v make >/dev/null 2>&1 || ! command -v python3 >/dev/null 2>&1; then
  if [ "$(id -u)" -eq 0 ]; then
    apt-get update
    DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 make g++
  elif command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
    sudo apt-get update
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends python3 make g++
  else
    echo "Need python3, make, and g++ to rebuild sqlite3. Install those packages, then rerun this script." >&2
    exit 1
  fi
fi

npm rebuild sqlite3 --build-from-source --prefix backend

if ! ( cd backend && node -e "require('sqlite3')" ); then
  echo "sqlite3 still does not load after the source rebuild." >&2
  exit 1
fi
echo "sqlite3 loads."
