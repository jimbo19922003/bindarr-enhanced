#!/usr/bin/env bash
# Start the isolated dev server. Safe to run more than once: if port 3001 is
# already open, this leaves that process alone and prints the address.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=3001
LOG=".devcontainer/data/start.log"
LOCK=".devcontainer/data/start.lock"

port_open() {
  # Do not use `timeout`. It moves the probe into a new process group, and the
  # Codespaces startup terminal can stop that group with SIGTTOU. A stopped
  # probe never returns, so the editor stays on "Opening remote...".
  bash -c "echo >/dev/tcp/127.0.0.1/${PORT}" </dev/null >/dev/null 2>&1 &
  local probe=$!
  local i
  for i in 1 2 3 4 5; do
    if ! kill -0 "$probe" 2>/dev/null; then
      wait "$probe" && return 0
      return 1
    fi
    sleep 0.1
  done
  kill "$probe" 2>/dev/null || true
  wait "$probe" 2>/dev/null || true
  return 1
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

# Start the server as an orphan. A process left in the Codespaces startup
# command's tree keeps the editor on "Opening remote..." until that process
# exits, and the server is not supposed to exit.
spawn_server() {
  mkdir -p .devcontainer/data
  if [ ! -x ./node_modules/.bin/concurrently ]; then
    echo "Dependencies are not installed. From the repository root run: bash .devcontainer/setup.sh" >&2
    return 1
  fi
  printf '\n===== %s starting Bindarr =====\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >> "$LOG"
  # Double-fork, close inherited descriptors (including lock fd 9), then exec.
  # The Python process this shell waits for exits immediately.
  python3 - "$PWD" "$LOG" << 'PY'
import os, sys
root, log_path = sys.argv[1], sys.argv[2]
script = os.path.join(root, ".devcontainer", "start.sh")
if os.fork() > 0:
    os._exit(0)
os.setsid()
if os.fork() > 0:
    os._exit(0)
os.chdir(root)
os.environ["BINDARR_START_CHILD"] = "1"
for fd in range(3, 256):
    try:
        os.close(fd)
    except OSError:
        pass
log_fd = os.open(log_path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o644)
devnull = os.open(os.devnull, os.O_RDONLY)
os.dup2(devnull, 0)
os.dup2(log_fd, 1)
os.dup2(log_fd, 2)
os.close(log_fd)
os.close(devnull)
os.execv("/bin/bash", ["bash", script, "--foreground"])
PY
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
