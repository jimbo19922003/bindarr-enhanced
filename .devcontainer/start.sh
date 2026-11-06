#!/usr/bin/env bash
# Start the isolated dev server. Safe to run more than once: if port 3001 is
# already open, this leaves that process alone and prints the address.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=3001
LOG=".devcontainer/data/start.log"
LOCK=".devcontainer/data/start.lock"

port_open() {
  # Bash /dev/tcp can block on a dead route. timeout keeps the check short.
  timeout 0.4 bash -c "echo >/dev/tcp/127.0.0.1/${PORT}" >/dev/null 2>&1
}

print_url() {
  echo ""
  echo "Bindarr is ready."
  echo "http://localhost:${PORT}"
  if [ -n "${CODESPACE_NAME:-}" ]; then
    local domain="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
    echo "https://${CODESPACE_NAME}-${PORT}.${domain}"
  fi
  echo "In the Ports panel, ${PORT} is labeled \"Bindarr test instance\"."
  echo "Open it with the globe icon and keep the visibility private."
  echo ""
}

wait_for_port() {
  local i
  for i in $(seq 1 240); do
    if port_open; then
      return 0
    fi
    if [ $((i % 15)) -eq 0 ]; then
      echo "Waiting for port ${PORT} (${i}s). Log: ${LOG}"
    fi
    sleep 1
  done
  return 1
}

report_failure() {
  echo "Bindarr did not open port ${PORT}. Last lines of ${LOG}:" >&2
  if [ -f "$LOG" ]; then
    tail -n 60 "$LOG" >&2 || true
  else
    echo "(no log file)" >&2
  fi
}

# Start the real server in its own session. Codespaces ends the lifecycle
# command's process group when that command returns; a new session keeps
# Express running after postStartCommand finishes.
spawn_server() {
  mkdir -p .devcontainer/data
  if [ ! -x ./node_modules/.bin/concurrently ]; then
    echo "Dependencies are not installed. From the repository root run: bash .devcontainer/setup.sh" >&2
    return 1
  fi
  printf '\n===== %s starting Bindarr =====\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOG"
  # Close the lock fd (9). The child would otherwise inherit it and hold the
  # lock for the whole server lifetime.
  BINDARR_START_CHILD=1 setsid nohup bash "$0" --foreground >> "$LOG" 2>&1 9>&- < /dev/null &
  echo $! > .devcontainer/data/server.pid
  echo "Starting Bindarr in the background. Log: ${LOG}"
}

# strict: a person or the attach terminal. Exit 1 when the port never opens.
# loose: container start. Exit 0 either way so the editor still opens.
ensure_started() {
  local mode="$1"
  mkdir -p .devcontainer/data
  exec 9>"$LOCK"
  if ! flock -w 300 9; then
    echo "Another Bindarr start is still in progress." >&2
    if [ "$mode" = "strict" ]; then
      exit 1
    fi
    exit 0
  fi
  if port_open; then
    print_url
    exit 0
  fi
  if ! spawn_server; then
    if [ "$mode" = "strict" ]; then
      exit 1
    fi
    exit 0
  fi
  if wait_for_port; then
    print_url
    exit 0
  fi
  report_failure
  if [ "$mode" = "strict" ]; then
    exit 1
  fi
  exit 0
}

run_foreground() {
  export DB_PATH="$PWD/.devcontainer/data/bindarr.db"
  export PORT
  export HTTPS_PORT=
  export ALLOW_REGISTRATION=false
  # Codespace file events are not always delivered to a watcher. Polling keeps
  # nodemon and the frontend rebuild running after an edit.
  export CHOKIDAR_USEPOLLING=1
  export CHOKIDAR_INTERVAL=1000
  mkdir -p .devcontainer/data

  if [ "${BINDARR_START_CHILD:-}" != "1" ]; then
    exec 9>"$LOCK"
    if ! flock -n 9; then
      echo "Bindarr is already starting. Waiting for port ${PORT}."
      if wait_for_port; then
        print_url
        exit 0
      fi
      report_failure
      exit 1
    fi
  fi

  if port_open; then
    echo "Port ${PORT} is already open. Leave the existing dev server running."
    print_url
    exit 0
  fi

  if [ ! -x ./node_modules/.bin/concurrently ]; then
    echo "Dependencies are not installed. From the repository root run: bash .devcontainer/setup.sh" >&2
    exit 1
  fi

  if [ ! -f frontend/dist/index.html ]; then
    npm run build:frontend
  fi

  # Printed before listen as well as by the server, so a terminal session
  # gives Codespaces a localhost URL to forward.
  echo "http://localhost:${PORT}"
  exec ./node_modules/.bin/concurrently --kill-others \
    "npm run dev:backend" \
    "npm run build --prefix frontend -- --watch"
}

case "${1:-}" in
  --background) ensure_started loose ;;
  --ensure) ensure_started strict ;;
  --foreground|"") run_foreground ;;
  *)
    echo "Usage: bash .devcontainer/start.sh [--ensure|--background]" >&2
    exit 2
    ;;
esac
