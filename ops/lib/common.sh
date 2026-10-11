# shellcheck shell=bash
# Shared helpers for ops/release.sh and ops/new-franchise.sh. Source it; do
# not run it.
#
# Layout on the server (override FINERP_ROOT only for testing):
#   $FINERP_ROOT/repo      git clone, branch `production` checked out
#   $FINERP_ROOT/env       <slug>.env (secret, chmod 600) + <slug>.deploy
#   $FINERP_ROOT/state     <slug>.current / <slug>.previous image shas, lock
#   $FINERP_ROOT/backups
#
# Set DRY_RUN=1 before calling `run` to print commands instead of running them.

FINERP_ROOT=${FINERP_ROOT:-/srv/finerp}
REPO_DIR=${REPO_DIR:-$FINERP_ROOT/repo}
ENV_DIR=$FINERP_ROOT/env
STATE_DIR=$FINERP_ROOT/state
OPS_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
COMPOSE_FILE=$OPS_DIR/compose.yaml
IMAGE_REPO=finerp-api
# shellcheck disable=SC2034  # used by new-franchise.sh
BASE_DOMAIN=sriadithyafinance.loan
DRY_RUN=${DRY_RUN:-0}

log()  { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*"; }
warn() { printf '%s  WARNING: %s\n' "$(date '+%H:%M:%S')" "$*" >&2; }
die()  { printf '%s  ERROR: %s\n' "$(date '+%H:%M:%S')" "$*" >&2; exit 1; }

# Run a command, or only print it under --dry-run.
run() {
  if [ "$DRY_RUN" = 1 ]; then
    printf '   [dry-run] %s\n' "$*"
  else
    "$@"
  fi
}

require_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die "required command not found: $c"
  done
}

# Ask a yes/no question; only an explicit y/yes continues.
confirm() {
  local answer
  read -r -p "$1 [y/N] " answer
  case $answer in y | Y | yes | YES) return 0 ;; *) return 1 ;; esac
}

# --------------------------------------------------------------------------
# Tenants (<slug>.deploy files)
# --------------------------------------------------------------------------

# deploy_get <slug> <KEY>: read one KEY=VALUE from a .deploy file without
# sourcing it.
deploy_get() {
  local file=$ENV_DIR/$1.deploy
  [ -f "$file" ] || die "no deploy file: $file"
  sed -n "s/^$2=//p" "$file" | tail -n 1
}

# slugs_for_channel <channel>: every slug whose .deploy says CHANNEL=<channel>.
slugs_for_channel() {
  local f slug
  for f in "$ENV_DIR"/*.deploy; do
    [ -e "$f" ] || continue
    slug=$(basename "$f" .deploy)
    [ "$(deploy_get "$slug" CHANNEL)" = "$1" ] && echo "$slug"
  done
  return 0
}

# --------------------------------------------------------------------------
# Containers
# --------------------------------------------------------------------------

# compose_up <slug> <image-tag>: (re)create the slug's container on that tag.
compose_up() {
  run env IMAGE_TAG="$2" FINERP_ENV_DIR="$ENV_DIR" docker compose -p "finerp-$1" -f "$COMPOSE_FILE" \
    --env-file "$ENV_DIR/$1.deploy" up -d --force-recreate --no-build --pull never
}

# migrate_slug <slug> <image-tag>: apply migrations in a one-off container
# with that slug's env.
migrate_slug() {
  run docker run --rm --env-file "$ENV_DIR/$1.env" "$IMAGE_REPO:$2" python migrate.py apply
}

# migrations_applied <port>: applied_count from the running container's
# /migrations, or "?" when it cannot be read.
migrations_applied() {
  curl -fsS --max-time 5 "http://127.0.0.1:$1/migrations" 2>/dev/null |
    python3 -c 'import json,sys; print(json.load(sys.stdin)["applied_count"])' 2>/dev/null ||
    echo '?'
}

# wait_healthy <port> [timeout-seconds]
# Polls /readyz. Returns 0 when ready (HTTP 200), 2 when the only failing
# check is s3 (degraded: db and migrations are fine), 1 otherwise or on
# timeout. The 503 body is the app's error envelope
# {"error":{"message":{"status":..,"checks":{..}}}}; the older
# {"detail":{"checks":..}} shape is accepted too.
wait_healthy() {
  local port=$1 deadline=$((SECONDS + ${2:-90})) body code verdict
  [ "$DRY_RUN" = 1 ] && { printf '   [dry-run] wait for http://127.0.0.1:%s/readyz\n' "$port"; return 0; }
  while [ "$SECONDS" -lt "$deadline" ]; do
    body=$(curl -sS --max-time 5 -w '\n%{http_code}' "http://127.0.0.1:$port/readyz" 2>/dev/null) || body=$'\n000'
    code=${body##*$'\n'}
    if [ "$code" = 200 ]; then
      return 0
    fi
    verdict=$(printf '%s' "${body%$'\n'*}" | python3 -c '
import json, sys
try:
    j = json.load(sys.stdin)
except Exception:
    print("unknown"); sys.exit()
checks = None
if isinstance(j.get("detail"), dict):
    checks = j["detail"].get("checks")
err = j.get("error")
if checks is None and isinstance(err, dict) and isinstance(err.get("message"), dict):
    checks = err["message"].get("checks")
if not isinstance(checks, dict):
    print("unknown")
elif [k for k, v in checks.items() if v != "ok"] == ["s3"]:
    print("s3only")
else:
    print("failing")
' 2>/dev/null)
    if [ "$verdict" = s3only ]; then
      return 2
    fi
    sleep 3
  done
  return 1
}

# --------------------------------------------------------------------------
# State: which image each slug runs, for rollback
# --------------------------------------------------------------------------

state_get() { cat "$STATE_DIR/$1.$2" 2>/dev/null || true; }

# state_record <slug> <tag>: current -> previous, tag -> current.
state_record() {
  [ "$DRY_RUN" = 1 ] && return 0
  local cur
  cur=$(state_get "$1" current)
  if [ -n "$cur" ] && [ "$cur" != "$2" ]; then
    printf '%s\n' "$cur" >"$STATE_DIR/$1.previous"
  fi
  printf '%s\n' "$2" >"$STATE_DIR/$1.current"
}

# image_exists <tag>
image_exists() { docker image inspect "$IMAGE_REPO:$1" >/dev/null 2>&1; }

# Take the release lock or die (one release or onboarding at a time).
take_lock() {
  [ "$DRY_RUN" = 1 ] && return 0
  mkdir -p "$STATE_DIR"
  exec 9>"$STATE_DIR/release.lock"
  flock -n 9 || die "another release or onboarding is running (lock: $STATE_DIR/release.lock)"
}
