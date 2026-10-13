#!/usr/bin/env bash
# Back up every tenant database on the Singapore server to S3.
#
# Usage:
#   ops/backup.sh [<slug>...]     (no slug: every $FINERP_ROOT/env/*.env)
#
# Per tenant:
#   1. read DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD from <slug>.env
#      without sourcing it (the file is Docker-literal); refuse a -pooler host
#   2. pg_dump -Fc --no-owner --no-privileges into $FINERP_ROOT/backups
#   3. check the dump: pg_restore -l can read it, it holds the
#      schema_migrations data, it is at least MIN_BYTES and at least
#      MIN_PERCENT% of the newest dump already in S3 for that slug
#   4. upload to s3://$BACKUP_BUCKET/<slug>/<YYYY-MM-DD>.dump (date in IST)
#      with SSE-S3, then read the size back
#   5. delete the local file (also when a step fails)
# A failing tenant does not stop the others; the exit code is 1 if any
# tenant failed. Output goes to stdout/stderr, i.e. the journal under systemd.
#
# Install (runs from a fixed path, not from the repo, so a release merge never
# rewrites it mid-run; re-run the first line after changing this file):
#   sudo install -m 755 ops/backup.sh /usr/local/sbin/finerp-backup
#   sudo install -m 644 ops/systemd/finerp-backup.service ops/systemd/finerp-backup.timer /etc/systemd/system/
#   sudo systemctl daemon-reload && sudo systemctl enable --now finerp-backup.timer
#
# Check:
#   systemctl list-timers finerp-backup.timer
#   journalctl -u finerp-backup -n 50
#   aws s3 ls s3://finerp-backups/main/
#
# Needs: pg_dump/pg_restore >= the server's major version (18), aws CLI
# (instance role), flock.
set -euo pipefail

FINERP_ROOT=${FINERP_ROOT:-/srv/finerp}
ENV_DIR=$FINERP_ROOT/env
BACKUP_DIR=$FINERP_ROOT/backups
STATE_DIR=$FINERP_ROOT/state
BACKUP_BUCKET=${BACKUP_BUCKET:-finerp-backups}
BACKUP_REGION=${BACKUP_REGION:-ap-southeast-1}
MIN_BYTES=${MIN_BYTES:-20000}
MIN_PERCENT=${MIN_PERCENT:-50}

log()  { printf '%s  %s\n' "$(date '+%H:%M:%S')" "$*"; }
warn() { printf '%s  WARNING: %s\n' "$(date '+%H:%M:%S')" "$*" >&2; }
die()  { printf '%s  ERROR: %s\n' "$(date '+%H:%M:%S')" "$*" >&2; exit 1; }

usage() { sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

require_cmd() {
  local c
  for c in "$@"; do
    command -v "$c" >/dev/null 2>&1 || die "required command not found: $c"
  done
}

# env_get <file> <KEY>: one KEY=VALUE from an env file, taken literally.
env_get() { sed -n "s/^$2=//p" "$1" | tail -n 1; }

# backup_tenant <slug>: runs in a subshell, so `die` fails only this tenant
# and the PG* variables never leak into the next one. Call it with errexit
# off and read $? (see main): bash ignores `set -e` inside a function called
# from `if`/`||`, even if the function sets it again.
backup_tenant() (
  set -e
  local slug=$1 file=$ENV_DIR/$1.env day key dump size prev toc entries remote sse
  [[ $slug =~ ^[a-z][a-z0-9-]{1,20}$ ]] || die "bad slug: $slug"
  [ -f "$file" ] || die "$slug: no env file $file"

  PGHOST=$(env_get "$file" DB_HOST)
  PGPORT=$(env_get "$file" DB_PORT)
  PGDATABASE=$(env_get "$file" DB_NAME)
  PGUSER=$(env_get "$file" DB_USER)
  PGPASSWORD=$(env_get "$file" DB_PASSWORD)
  PGPORT=${PGPORT:-5432}
  if [ -z "$PGHOST" ] || [ -z "$PGDATABASE" ] || [ -z "$PGUSER" ] || [ -z "$PGPASSWORD" ]; then
    die "$slug: DB_HOST, DB_NAME, DB_USER or DB_PASSWORD missing in $file"
  fi
  case $PGHOST in *-pooler*) die "$slug: DB_HOST is a -pooler host; use the direct endpoint" ;; esac
  export PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD
  export PGSSLMODE=require PGCONNECT_TIMEOUT=30 PGAPPNAME=finerp-backup

  day=$(TZ=Asia/Kolkata date +%F)
  key=$slug/$day.dump
  dump=$(mktemp "$BACKUP_DIR/$slug.XXXXXX.dump")
  trap 'rm -f "$dump"' EXIT

  log "$slug: pg_dump $PGDATABASE on $PGHOST"
  # One retry: a sleeping free-tier Neon compute can drop the first connect.
  if ! pg_dump -Fc --no-owner --no-privileges -f "$dump"; then
    warn "$slug: pg_dump failed, retrying in 30 s"
    sleep 30
    pg_dump -Fc --no-owner --no-privileges -f "$dump" || die "$slug: pg_dump failed twice"
  fi

  size=$(stat -c %s "$dump")
  toc=$(pg_restore -l "$dump") || die "$slug: pg_restore -l cannot read the dump"
  entries=$(grep -c ' TABLE DATA ' <<<"$toc") || true
  grep -q ' TABLE DATA public schema_migrations ' <<<"$toc" ||
    die "$slug: dump has no schema_migrations data"
  [ "$size" -ge "$MIN_BYTES" ] || die "$slug: dump is only $size bytes (MIN_BYTES=$MIN_BYTES)"
  # shellcheck disable=SC2016  # backticks are a JMESPath literal, not a command
  prev=$(aws s3api list-objects-v2 --region "$BACKUP_REGION" --bucket "$BACKUP_BUCKET" --prefix "$slug/" \
    --query 'sort_by(Contents || `[]`, &LastModified)[-1].Size' --output text) ||
    die "$slug: cannot list s3://$BACKUP_BUCKET/$slug/"
  if [[ $prev =~ ^[0-9]+$ ]] && [ $((size * 100)) -lt $((prev * MIN_PERCENT)) ]; then
    die "$slug: dump is $size bytes, under $MIN_PERCENT% of the newest one in S3 ($prev bytes)"
  fi

  aws s3 cp "$dump" "s3://$BACKUP_BUCKET/$key" --region "$BACKUP_REGION" --sse AES256 \
    --only-show-errors --no-progress || die "$slug: upload to s3://$BACKUP_BUCKET/$key failed"
  read -r remote sse < <(aws s3api head-object --region "$BACKUP_REGION" --bucket "$BACKUP_BUCKET" \
    --key "$key" --query '[ContentLength, ServerSideEncryption]' --output text) ||
    die "$slug: cannot read back s3://$BACKUP_BUCKET/$key"
  [ "$remote" = "$size" ] || die "$slug: uploaded size $remote != local size $size"
  log "$slug: ok s3://$BACKUP_BUCKET/$key ($size bytes, $entries tables with data, $sse)"
)

main() {
  local slugs=() failed=() slug f rc v
  case ${1:-} in -h | --help) usage 0 ;; esac
  require_cmd pg_dump pg_restore aws flock
  [ -d "$BACKUP_DIR" ] || die "no backup dir: $BACKUP_DIR"

  if [ $# -gt 0 ]; then
    slugs=("$@")
  else
    for f in "$ENV_DIR"/*.env; do
      [ -e "$f" ] && slugs+=("$(basename "$f" .env)")
    done
  fi
  [ "${#slugs[@]}" -gt 0 ] || die "no tenants found in $ENV_DIR"

  # Stale exported PG* variables (PGSERVICE, PGPASSFILE, ...) would override
  # what each env file says.
  for v in $(compgen -v PG); do unset "$v"; done
  umask 077

  exec 8>"$STATE_DIR/backup.lock"
  flock -n 8 || die "another backup is running (lock: $STATE_DIR/backup.lock)"

  log "backup of ${#slugs[@]} tenant(s) to s3://$BACKUP_BUCKET: ${slugs[*]}"
  for slug in "${slugs[@]}"; do
    set +e
    backup_tenant "$slug"
    rc=$?
    set -e
    [ "$rc" -eq 0 ] || failed+=("$slug")
  done

  if [ "${#failed[@]}" -gt 0 ]; then
    die "${#failed[@]} of ${#slugs[@]} tenant(s) failed: ${failed[*]}"
  fi
  log "all ${#slugs[@]} tenant(s) backed up"
}

main "$@"
