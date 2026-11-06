#!/usr/bin/env bash
# Start the isolated dev server. Safe to run more than once: if port 3001 is
# already open, this exits without launching a second copy.
set -euo pipefail
cd "$(dirname "$0")/.."

port_open() {
  node --input-type=module -e 'import net from "node:net"; const socket = net.connect(3001, "127.0.0.1"); const stop = (code) => { socket.destroy(); process.exit(code); }; socket.once("connect", () => stop(0)); socket.once("error", () => stop(1)); setTimeout(() => stop(1), 400);'
}

if [ "${1:-}" = "--background" ]; then
  mkdir -p .devcontainer/data
  if port_open; then
    echo "Bindarr is already listening on port 3001."
    exit 0
  fi
  nohup bash "$0" >> .devcontainer/data/start.log 2>&1 &
  echo "Bindarr is starting in the background. Log: .devcontainer/data/start.log"
  exit 0
fi

export DB_PATH="$PWD/.devcontainer/data/bindarr.db"
export PORT=3001
export HTTPS_PORT=
export ALLOW_REGISTRATION=false
# Codespace file events are not always delivered to a watcher. Polling keeps
# nodemon and the frontend rebuild running after an edit.
export CHOKIDAR_USEPOLLING=1
export CHOKIDAR_INTERVAL=1000
mkdir -p .devcontainer/data

if port_open; then
  echo "Port 3001 is already open. Leave the existing dev server running."
  exit 0
fi

if [ ! -x ./node_modules/.bin/concurrently ]; then
  echo "Dependencies are not installed. From the repository root run: bash .devcontainer/setup.sh" >&2
  exit 1
fi

if [ ! -f frontend/dist/index.html ]; then
  npm run build:frontend
fi

exec ./node_modules/.bin/concurrently --kill-others \
  "npm run dev:backend" \
  "npm run build --prefix frontend -- --watch"
