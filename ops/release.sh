#!/usr/bin/env bash
# Release FinERP backends on the Singapore server.
#
# Usage:
#   ops/release.sh production [--dry-run]
#   ops/release.sh production --only <slug> [--dry-run]
#   ops/release.sh develop [--dry-run]
#
# production (main + every franchise whose .deploy says CHANNEL=production):
#   1. fetch; merge origin/develop into the local `production` branch
#   2. build finerp-api:<sha> from `git archive <sha>:backend`
#   3. per slug: migrate in a one-off container with the slug's env,
#      recreate its container on finerp-api:<sha>, wait until healthy
#   4. any failure: put every touched slug back on its previous image,
#      reset `production` to where it was, warn if migrations already
#      landed, exit 1
#   5. all healthy: move finerp-api:production to <sha>, then push
#      `production` (Cloudflare Pages builds it) and every branch in
#      MIRROR_BRANCHES (default `uat`, which keeps the Vercel frontend in
#      sync; Phase 6 sets MIRROR_BRANCHES= or drops the default)
#
# production --only <slug>: no fetch, merge or push. Brings one slug to the
#   already-released `production` HEAD (retry a failed franchise, or catch up
#   one that was skipped). The channel tag does not move.
#
# develop (the dev tenant): build origin/develop, migrate and recreate every
#   CHANNEL=develop slug, move finerp-api:develop. No merge, no push.
#
# Health: /readyz 200 is ready. An s3-only failure is "degraded" and passes
# with a warning (set ALLOW_DEGRADED=0 to treat it as a failure). Anything
# else after 90 s fails the release.
#
# State: $FINERP_ROOT/state/<slug>.current and <slug>.previous hold the image
# tags each slug ran, used for rollback. Migrations are forward-only; a
# rollback restores code, never schema.
#
# Exit codes: 0 released, 1 failed (rolled back), 2 released but a push
# failed (run the printed git push by hand).
set -euo pipefail

# Everything runs inside main(), called on the last line: bash then parses the
# whole file before executing, so the merge below can safely rewrite this
# script on disk while it runs.
main() {

# shellcheck source=lib/common.sh
. "$(dirname "$0")/lib/common.sh"

MIRROR_BRANCHES=${MIRROR_BRANCHES-uat}
ALLOW_DEGRADED=${ALLOW_DEGRADED:-1}

usage() { sed -n '2,8p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

CHANNEL=
ONLY=
while [ $# -gt 0 ]; do
  case $1 in
    production | develop) CHANNEL=$1 ;;
    --only) ONLY=${2:-}; [ -n "$ONLY" ] || usage 1; shift ;;
    --dry-run) DRY_RUN=1 ;;
    -h | --help) usage 0 ;;
    *) echo "unknown argument: $1" >&2; usage 1 ;;
  esac
  shift
done
[ -n "$CHANNEL" ] || usage 1
[ -z "$ONLY" ] || [ "$CHANNEL" = production ] || die "--only is for the production channel"

# --------------------------------------------------------------------------
# Preflight
# --------------------------------------------------------------------------
require_cmd git docker curl python3 flock
[ -d "$REPO_DIR/.git" ] || die "no git clone at $REPO_DIR"
[ -f "$COMPOSE_FILE" ] || die "missing $COMPOSE_FILE"
cd "$REPO_DIR"
[ -z "$(git status --porcelain)" ] || die "working tree at $REPO_DIR is dirty; commit, stash or clean it first"

if [ -n "$ONLY" ]; then
  [ -f "$ENV_DIR/$ONLY.deploy" ] || die "no $ENV_DIR/$ONLY.deploy"
  [ "$(deploy_get "$ONLY" CHANNEL)" = "$CHANNEL" ] || die "$ONLY is not on channel $CHANNEL"
  SLUGS=("$ONLY")
else
  mapfile -t SLUGS < <(slugs_for_channel "$CHANNEL")
fi
[ "${#SLUGS[@]}" -gt 0 ] || die "no slugs on channel $CHANNEL in $ENV_DIR"
for s in "${SLUGS[@]}"; do
  [ -f "$ENV_DIR/$s.env" ] || die "missing $ENV_DIR/$s.env"
  [ -n "$(deploy_get "$s" PORT)" ] || die "no PORT in $s.deploy"
done

[ "$DRY_RUN" = 1 ] && log "DRY RUN: nothing will be changed"
take_lock
log "channel=$CHANNEL slugs=${SLUGS[*]}"

# --------------------------------------------------------------------------
# Resolve the commit to release
# --------------------------------------------------------------------------
PREV_HEAD=
MERGED=0
if [ "$CHANNEL" = production ]; then
  [ "$(git symbolic-ref --short HEAD)" = production ] || die "$REPO_DIR must have branch production checked out"
  PREV_HEAD=$(git rev-parse HEAD)
  if [ -z "$ONLY" ]; then
    log "fetching origin"
    git fetch --prune origin
    if git rev-parse -q --verify origin/production >/dev/null &&
      ! git merge-base --is-ancestor origin/production HEAD; then
      die "origin/production has commits the local branch lacks; reconcile $REPO_DIR first"
    fi
    if [ -n "$(git log --oneline HEAD..origin/develop)" ]; then
      log "merging origin/develop into production:"
      git log --oneline HEAD..origin/develop | sed 's/^/     /'
      if [ "$DRY_RUN" = 1 ]; then
        printf '   [dry-run] git merge --no-edit origin/develop\n'
      else
        git merge --no-edit origin/develop || { git merge --abort || true; die "merge failed; production left unchanged"; }
        MERGED=1
      fi
    else
      log "production already contains origin/develop; redeploying HEAD"
    fi
  fi
  SHA=$(git rev-parse --short=12 HEAD)
  if [ "$DRY_RUN" = 1 ] && [ -z "$ONLY" ] && [ -n "$(git log --oneline HEAD..origin/develop)" ]; then
    SHA="<merge-commit>"
  fi
else
  log "fetching origin"
  git fetch --prune origin
  SHA=$(git rev-parse --short=12 origin/develop)
fi
log "release image: $IMAGE_REPO:$SHA"

undo_merge() {
  if [ "$MERGED" = 1 ]; then
    warn "resetting production back to ${PREV_HEAD:0:12}"
    git reset --hard "$PREV_HEAD"
  fi
}

# --------------------------------------------------------------------------
# Build
# --------------------------------------------------------------------------
if [ "$DRY_RUN" = 1 ]; then
  printf '   [dry-run] git archive %s:backend | docker build -t %s:%s -\n' "$SHA" "$IMAGE_REPO" "$SHA"
elif image_exists "$SHA"; then
  log "image $IMAGE_REPO:$SHA already built"
else
  log "building $IMAGE_REPO:$SHA"
  if ! git archive --format=tar "$SHA:backend" | docker build -t "$IMAGE_REPO:$SHA" -; then
    undo_merge
    die "image build failed"
  fi
fi

# --------------------------------------------------------------------------
# Deploy each slug
# --------------------------------------------------------------------------
declare -A PREV_TAG BEFORE AFTER HEALTH
SWITCHED=()

# The image a slug runs now, as a tag rollback can use. Falls back to tagging
# the running container's image when no state was recorded yet.
previous_tag_for() {
  local slug=$1 tag id
  tag=$(state_get "$slug" current)
  if [ -n "$tag" ] && image_exists "$tag"; then
    echo "$tag"
    return
  fi
  id=$(docker inspect -f '{{.Image}}' "finerp-api-$slug" 2>/dev/null || true)
  if [ -n "$id" ]; then
    docker tag "$id" "$IMAGE_REPO:rollback-$slug" && echo "rollback-$slug"
  fi
}

rollback() {
  warn "$1"
  local s rc
  for s in "${SWITCHED[@]}"; do
    if [ -n "${PREV_TAG[$s]:-}" ]; then
      warn "rolling $s back to $IMAGE_REPO:${PREV_TAG[$s]}"
      compose_up "$s" "${PREV_TAG[$s]}" || warn "could not recreate $s on its previous image"
      rc=0
      wait_healthy "$(deploy_get "$s" PORT)" || rc=$?
      [ "$rc" = 1 ] && warn "$s is NOT healthy after rollback; check: docker logs finerp-api-$s"
    else
      warn "$s had no previous image; it stays on the failed build (fix forward)"
    fi
  done
  undo_merge
  for s in "${SLUGS[@]}"; do
    [ -n "${BEFORE[$s]:-}" ] || continue
    local now
    now=$(migrations_applied "$(deploy_get "$s" PORT)")
    if [ "${BEFORE[$s]}" != "?" ] && [ "$now" != "?" ] && [ "$now" != "${BEFORE[$s]}" ]; then
      warn "$s: migrations went ${BEFORE[$s]} -> $now but its code was rolled back; the old code must tolerate the new schema"
    fi
  done
  die "release failed and was rolled back"
}

for s in "${SLUGS[@]}"; do
  port=$(deploy_get "$s" PORT)
  log "--- $s (port $port)"
  if [ "$DRY_RUN" = 1 ]; then
    PREV_TAG[$s]=$(state_get "$s" current)
  else
    PREV_TAG[$s]=$(previous_tag_for "$s")
  fi
  BEFORE[$s]=$(migrations_applied "$port")
  log "$s: previous image ${PREV_TAG[$s]:-<none>}, migrations applied ${BEFORE[$s]}"

  log "$s: migrating"
  migrate_slug "$s" "$SHA" || rollback "$s: migrations failed"

  SWITCHED+=("$s")
  log "$s: recreating container on $IMAGE_REPO:$SHA"
  compose_up "$s" "$SHA" || rollback "$s: container recreate failed"

  rc=0
  wait_healthy "$port" || rc=$?
  case $rc in
    0) HEALTH[$s]=ready ;;
    2)
      [ "$ALLOW_DEGRADED" = 1 ] || rollback "$s: degraded (s3 failing) and ALLOW_DEGRADED=0"
      warn "$s: degraded, s3 check failing (db and migrations ok)"
      HEALTH[$s]=degraded
      ;;
    *) rollback "$s: not healthy after 90 s (docker logs finerp-api-$s)" ;;
  esac
  AFTER[$s]=$(migrations_applied "$port")
done

# --------------------------------------------------------------------------
# Success: record state, move the channel tag, push last
# --------------------------------------------------------------------------
for s in "${SLUGS[@]}"; do
  state_record "$s" "$SHA"
done
if [ -z "$ONLY" ]; then
  run docker tag "$IMAGE_REPO:$SHA" "$IMAGE_REPO:$CHANNEL"
fi

log "released $IMAGE_REPO:$SHA"
for s in "${SLUGS[@]}"; do
  printf '     %-12s port %-5s migrations %s -> %s  %s\n' "$s" "$(deploy_get "$s" PORT)" \
    "${BEFORE[$s]}" "${AFTER[$s]:-?}" "${HEALTH[$s]:-dry-run}"
done

status=0
if [ "$CHANNEL" = production ] && [ -z "$ONLY" ]; then
  log "pushing production"
  run git push origin production || { warn "push failed; run: git -C $REPO_DIR push origin production"; status=2; }
  for b in $MIRROR_BRANCHES; do
    log "mirroring to $b"
    run git push origin "HEAD:refs/heads/$b" || { warn "push failed; run: git -C $REPO_DIR push origin HEAD:refs/heads/$b"; status=2; }
  done
fi
exit "$status"
}

main "$@"
