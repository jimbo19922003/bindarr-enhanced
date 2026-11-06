#!/usr/bin/env bash
# Start the isolated dev server in this terminal. Safe to run more than once:
# if port 3001 is already open, this prints the address and exits.
set -euo pipefail
cd "$(dirname "$0")/.."

PORT=3001
LOCK=".devcontainer/data/start.lock"

port_open() {
  # Do not use `timeout`. It moves the probe into a new process group, and the
  # Codespaces startup terminal can stop that group with SIGTTOU.
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
  echo "A 502 from that host means this process is not listening yet. Refresh after the server banner."
  echo ""
}

wait_for_port() {
  local i
  for i in $(seq 1 90); do
    if port_open; then
      return 0
    fi
    sleep 1
  done
  return 1
}

mkdir -p .devcontainer/data
if port_open; then
  echo "Port ${PORT} is already open. Leave that dev server running."
  print_url
  exit 0
fi

exec 9>"$LOCK"
if ! flock -n 9; then
  echo "Bindarr is already starting in another terminal. Waiting for port ${PORT}."
  if wait_for_port; then
    print_url
    exit 0
  fi
  echo "Port ${PORT} did not open. Check the terminal that is running the server." >&2
  exit 1
fi

if [ ! -x ./node_modules/.bin/concurrently ]; then
  echo "Dependencies are not installed. From the repository root run: bash .devcontainer/setup.sh" >&2
  exit 1
fi

if [ ! -f frontend/dist/index.html ]; then
  npm run build:frontend
fi

# The prebuilt sqlite3 module crashes on this image (GLIBC_2.38). Rebuild once
# before nodemon, or the process exits before it listens and the port returns 502.
bash .devcontainer/rebuild-sqlite3.sh

# GitHub's port proxy sets X-Forwarded-For. express-rate-limit rejects that
# header unless Express trusts the one proxy in front of it, and the request
# then fails. A hop count of 1 is this proxy only. An operator who set
# TRUST_PROXY already keeps their own value.
if [ -n "${CODESPACE_NAME:-}" ] && [ -z "${TRUST_PROXY:-}" ]; then
  export TRUST_PROXY=1
fi

echo "Starting Bindarr in this terminal. Leave it open."
echo "http://localhost:${PORT}"
# nodemon treats end-of-stdin as "the user closed the terminal" and exits.
# A detached start has stdin on /dev/null, so that exit is immediate, the
# process never listens, and the Codespaces port returns HTTP 502.
# --no-stdin keeps the dev server alive. The lock fd stays open across exec
# so a second start waits instead of launching another copy.
exec ./node_modules/.bin/concurrently --names backend,frontend \
  "npm run dev --prefix backend -- --no-stdin" \
  "npm run build --prefix frontend -- --watch"
