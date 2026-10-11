#!/usr/bin/env bash
# Bring up a new franchise tenant on the Singapore server.
#
# Usage:
#   ops/new-franchise.sh <slug> "<Display Name>" "<Short Name>" [--dry-run]
#   e.g. ops/new-franchise.sh vizag "Sri Adithya Finance – Vizag" "Vizag"
#
# Before running: create the franchise's Neon project (finerp-<slug>, AWS
# Singapore) and have its DIRECT connection details to hand (host without
# -pooler). The script prompts for them; the password is never echoed.
#
# Steps (a step whose result already exists is skipped, so it is safe to
# re-run after a failure):
#   1. validate the slug: ^[a-z][a-z0-9-]{1,20}$, not main/dev/app/api/www
#   2. allocate the next free port (8102 and up)
#   3. write $FINERP_ROOT/env/<slug>.env (chmod 600) from
#      ops/env/app.env.example with a fresh SECRET_KEY, the Neon fields,
#      CORS_ORIGINS=https://<slug>.sriadithyafinance.loan,
#      S3_BUCKET_NAME=finerp-docs-<slug> and a staggered NIGHTLY_JOB_MINUTE
#   4. write <slug>.deploy (SLUG, PORT, CHANNEL=production)
#   5. create S3 bucket finerp-docs-<slug> in ap-south-1: SSE-S3, all public
#      access blocked
#   6. run migrations (an empty database loads the schema baseline), save
#      the names in org_settings, create the first SUPER_ADMIN interactively
#   7. append the tunnel ingress <slug>-api.sriadithyafinance.loan ->
#      localhost:<port> above the catch-all, after asking (needs sudo)
#   8. print the DNS and Cloudflare Pages custom-domain steps
#   9. start the container on the released production image and health-check
#
# Needs: docker, aws CLI (instance role), python3, curl, cloudflared, sudo,
# and a released finerp-api:production image (ops/release.sh production).
set -euo pipefail

# shellcheck source=lib/common.sh
. "$(dirname "$0")/lib/common.sh"

CLOUDFLARED_CONFIG=${CLOUDFLARED_CONFIG:-/etc/cloudflared/config.yml}
S3_REGION=ap-south-1
RESERVED="main dev app api www"

usage() { sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

ARGS=()
for a in "$@"; do
  case $a in
    --dry-run) DRY_RUN=1 ;;
    -h | --help) usage 0 ;;
    *) ARGS+=("$a") ;;
  esac
done
[ "${#ARGS[@]}" -eq 3 ] || usage 1
SLUG=${ARGS[0]}
DISPLAY_NAME=${ARGS[1]}
SHORT_NAME=${ARGS[2]}

# --------------------------------------------------------------------------
# 1. Validate
# --------------------------------------------------------------------------
[[ $SLUG =~ ^[a-z][a-z0-9-]{1,20}$ ]] || die "slug must match ^[a-z][a-z0-9-]{1,20}\$"
for r in $RESERVED; do
  [ "$SLUG" != "$r" ] || die "slug '$SLUG' is reserved"
done
[ "${#DISPLAY_NAME}" -ge 1 ] && [ "${#DISPLAY_NAME}" -le 100 ] || die "display name must be 1-100 characters"
[ "${#SHORT_NAME}" -ge 1 ] && [ "${#SHORT_NAME}" -le 30 ] || die "short name must be 1-30 characters"

API_HOST=$SLUG-api.$BASE_DOMAIN
APP_HOST=$SLUG.$BASE_DOMAIN
BUCKET=finerp-docs-$SLUG
ENV_FILE=$ENV_DIR/$SLUG.env
DEPLOY_FILE=$ENV_DIR/$SLUG.deploy

require_cmd docker python3 curl aws
[ -d "$ENV_DIR" ] || die "missing $ENV_DIR"
[ -f "$OPS_DIR/env/app.env.example" ] || die "missing ops/env/app.env.example"

# The image every production tenant runs: the slug state of main if known,
# else the moving channel tag.
IMAGE_TAG=$(state_get main current)
if [ -z "$IMAGE_TAG" ] || { [ "$DRY_RUN" != 1 ] && ! image_exists "$IMAGE_TAG"; }; then
  IMAGE_TAG=production
fi
[ "$DRY_RUN" = 1 ] || image_exists "$IMAGE_TAG" || die "no $IMAGE_REPO:$IMAGE_TAG image; run ops/release.sh production first"
IMAGE=$IMAGE_REPO:$IMAGE_TAG

[ "$DRY_RUN" = 1 ] && log "DRY RUN: nothing will be changed"
take_lock
log "franchise $SLUG: \"$DISPLAY_NAME\" / \"$SHORT_NAME\" on $IMAGE"

# --------------------------------------------------------------------------
# 2. Port
# --------------------------------------------------------------------------
if [ -f "$DEPLOY_FILE" ]; then
  PORT=$(deploy_get "$SLUG" PORT)
  log "2. port $PORT (from existing $SLUG.deploy)"
else
  PORT=8101
  for f in "$ENV_DIR"/*.deploy; do
    [ -e "$f" ] || continue
    p=$(sed -n 's/^PORT=//p' "$f" | tail -n 1)
    [[ $p =~ ^[0-9]+$ ]] && [ "$p" -gt "$PORT" ] && PORT=$p
  done
  PORT=$((PORT + 1))
  while ss -ltnH "( sport = :$PORT )" 2>/dev/null | grep -q .; do
    PORT=$((PORT + 1))
  done
  log "2. allocated port $PORT"
fi

# --------------------------------------------------------------------------
# 3. App env file
# --------------------------------------------------------------------------
if [ -f "$ENV_FILE" ]; then
  log "3. keeping existing $ENV_FILE"
elif [ "$DRY_RUN" = 1 ]; then
  printf '   [dry-run] prompt for Neon DB_HOST/DB_PORT/DB_NAME/DB_USER/DB_PASSWORD; write %s (chmod 600)\n' "$ENV_FILE"
else
  log "3. Neon DIRECT connection for finerp-$SLUG (host without -pooler)"
  read -r -p "   DB_HOST: " DB_HOST
  [ -n "$DB_HOST" ] || die "DB_HOST is required"
  case $DB_HOST in *-pooler*) die "that is a pooled host; use the direct one (no -pooler)" ;; esac
  read -r -p "   DB_PORT [5432]: " DB_PORT
  read -r -p "   DB_NAME [neondb]: " DB_NAME
  read -r -p "   DB_USER [neondb_owner]: " DB_USER
  read -r -s -p "   DB_PASSWORD: " DB_PASSWORD; echo
  read -r -s -p "   DB_PASSWORD again: " DB_PASSWORD2; echo
  [ -n "$DB_PASSWORD" ] && [ "$DB_PASSWORD" = "$DB_PASSWORD2" ] || die "passwords empty or different"
  unset DB_PASSWORD2

  # Values reach the writer through its environment, never argv (ps).
  umask 077
  FN_DB_HOST=$DB_HOST FN_DB_PORT=${DB_PORT:-5432} FN_DB_NAME=${DB_NAME:-neondb} \
    FN_DB_USER=${DB_USER:-neondb_owner} FN_DB_PASSWORD=$DB_PASSWORD \
    FN_SECRET_KEY=$(python3 -c 'import secrets; print(secrets.token_urlsafe(48))') \
    FN_S3_BUCKET_NAME=$BUCKET FN_CORS_ORIGINS=https://$APP_HOST \
    FN_NIGHTLY_JOB_MINUTE=$((((PORT - 8100) * 10) % 60)) \
    FN_ORG_DISPLAY_NAME=$DISPLAY_NAME FN_ORG_SHORT_NAME=$SHORT_NAME \
    python3 - "$OPS_DIR/env/app.env.example" "$ENV_FILE" <<'PY'
import os, re, sys
src, dst = sys.argv[1], sys.argv[2]
values = {k[3:]: v for k, v in os.environ.items() if k.startswith("FN_")}
for k, v in values.items():
    if "\n" in v or "\r" in v:
        sys.exit(f"{k} contains a newline")
out = []
for line in open(src, encoding="utf-8"):
    m = re.match(r"^([A-Z0-9_]+)=", line)
    if m and m.group(1) in values:
        line = f"{m.group(1)}={values.pop(m.group(1))}\n"
    out.append(line)
if values:
    sys.exit(f"template is missing: {', '.join(sorted(values))}")
header = f"# {os.path.basename(dst)}: written by ops/new-franchise.sh. SECRET, chmod 600.\n"
fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
with os.fdopen(fd, "w", encoding="utf-8") as f:
    f.write(header + "".join(out))
PY
  unset DB_PASSWORD
  log "3. wrote $ENV_FILE"
fi

# --------------------------------------------------------------------------
# 4. Deploy file
# --------------------------------------------------------------------------
if [ -f "$DEPLOY_FILE" ]; then
  log "4. keeping existing $DEPLOY_FILE"
elif [ "$DRY_RUN" = 1 ]; then
  printf '   [dry-run] write %s: SLUG=%s PORT=%s CHANNEL=production\n' "$DEPLOY_FILE" "$SLUG" "$PORT"
else
  printf 'SLUG=%s\nPORT=%s\nCHANNEL=production\n' "$SLUG" "$PORT" >"$DEPLOY_FILE"
  chmod 600 "$DEPLOY_FILE"
  log "4. wrote $DEPLOY_FILE"
fi

# --------------------------------------------------------------------------
# 5. S3 bucket
# --------------------------------------------------------------------------
if [ "$DRY_RUN" != 1 ] && aws s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  log "5. bucket $BUCKET already exists"
else
  log "5. creating bucket $BUCKET in $S3_REGION"
  run aws s3api create-bucket --bucket "$BUCKET" --region "$S3_REGION" \
    --create-bucket-configuration "LocationConstraint=$S3_REGION"
  run aws s3api put-public-access-block --bucket "$BUCKET" \
    --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
  run aws s3api put-bucket-encryption --bucket "$BUCKET" \
    --server-side-encryption-configuration \
    '{"Rules":[{"ApplyServerSideEncryptionByDefault":{"SSEAlgorithm":"AES256"}}]}'
fi

# --------------------------------------------------------------------------
# 6. Database: migrate, names, first SUPER_ADMIN
# --------------------------------------------------------------------------
log "6. migrations"
run docker run --rm --env-file "$ENV_FILE" "$IMAGE" python migrate.py apply

log "6. organisation names (kept if already saved)"
run docker run --rm -i --env-file "$ENV_FILE" \
  -e "FN_DISPLAY=$DISPLAY_NAME" -e "FN_SHORT=$SHORT_NAME" "$IMAGE" python - <<'PY'
import os
from sqlalchemy import text
from app.core.db import SessionLocal
with SessionLocal() as db:
    db.execute(
        text("INSERT INTO org_settings (id, display_name, short_name) "
             "VALUES (1, :d, :s) ON CONFLICT (id) DO NOTHING"),
        {"d": os.environ["FN_DISPLAY"], "s": os.environ["FN_SHORT"]},
    )
    db.commit()
    row = db.execute(text("SELECT display_name, short_name FROM org_settings")).one()
    print(f"   org_settings: {row[0]} / {row[1]}")
PY

if [ "$DRY_RUN" = 1 ]; then
  printf '   [dry-run] docker run --rm -it --env-file %s %s python scripts/create_superadmin.py\n' "$ENV_FILE" "$IMAGE"
else
  SA_COUNT=$(docker run --rm --env-file "$ENV_FILE" "$IMAGE" python -c "
from sqlalchemy import text
from app.core.db import SessionLocal
with SessionLocal() as db:
    print(db.execute(text(\"SELECT count(*) FROM users WHERE role = 'SUPER_ADMIN' AND is_active AND NOT is_deleted\")).scalar())
" | tail -n 1)
  if [ "$SA_COUNT" -gt 0 ]; then
    log "6. a SUPER_ADMIN already exists; skipping"
  else
    log "6. create the first SUPER_ADMIN (your own account)"
    TTY=(-i)
    [ -t 0 ] && TTY=(-it)
    docker run --rm "${TTY[@]}" --env-file "$ENV_FILE" "$IMAGE" python scripts/create_superadmin.py
  fi
fi

# --------------------------------------------------------------------------
# 7. Tunnel ingress
# --------------------------------------------------------------------------
if [ -f "$CLOUDFLARED_CONFIG" ] && grep -q "hostname: $API_HOST\$" "$CLOUDFLARED_CONFIG"; then
  log "7. tunnel ingress for $API_HOST already present"
elif [ "$DRY_RUN" = 1 ]; then
  printf '   [dry-run] add to %s above the catch-all:\n     - hostname: %s\n       service: http://localhost:%s\n' "$CLOUDFLARED_CONFIG" "$API_HOST" "$PORT"
else
  require_cmd cloudflared sudo
  [ -f "$CLOUDFLARED_CONFIG" ] || die "missing $CLOUDFLARED_CONFIG"
  log "7. tunnel ingress to add to $CLOUDFLARED_CONFIG (above the catch-all):"
  printf '     - hostname: %s\n       service: http://localhost:%s\n' "$API_HOST" "$PORT"
  if confirm "   Add it and restart cloudflared (brief blip for every tenant)?"; then
    NEW_CONFIG=$(mktemp)
    python3 - "$CLOUDFLARED_CONFIG" "$API_HOST" "$PORT" >"$NEW_CONFIG" <<'PY'
import re, sys
path, host, port = sys.argv[1], sys.argv[2], sys.argv[3]
lines = open(path, encoding="utf-8").read().splitlines(keepends=True)
idx = [i for i, l in enumerate(lines) if re.match(r"^\s*-\s*service:\s*http_status:404\s*$", l)]
if len(idx) != 1:
    sys.exit("expected exactly one catch-all '- service: http_status:404' line")
indent = re.match(r"^(\s*)", lines[idx[0]]).group(1)
lines[idx[0]:idx[0]] = [
    f"{indent}- hostname: {host}\n",
    f"{indent}  service: http://localhost:{port}\n",
]
sys.stdout.write("".join(lines))
PY
    BACKUP=$CLOUDFLARED_CONFIG.bak.$(date +%Y%m%d%H%M%S)
    sudo cp -p "$CLOUDFLARED_CONFIG" "$BACKUP"
    sudo cp "$NEW_CONFIG" "$CLOUDFLARED_CONFIG"
    rm -f "$NEW_CONFIG"
    if ! sudo cloudflared tunnel --config "$CLOUDFLARED_CONFIG" ingress validate; then
      sudo cp -p "$BACKUP" "$CLOUDFLARED_CONFIG"
      die "ingress did not validate; restored $BACKUP"
    fi
    sudo systemctl restart cloudflared
    log "7. ingress added (backup: $BACKUP)"
  else
    warn "7. skipped; re-run this script to add the ingress later"
  fi
fi

# --------------------------------------------------------------------------
# 9. Start the container (before printing the manual steps, so they come last)
# --------------------------------------------------------------------------
log "9. starting finerp-api-$SLUG on $IMAGE"
compose_up "$SLUG" "$IMAGE_TAG"
rc=0
wait_healthy "$PORT" || rc=$?
case $rc in
  0) log "9. $SLUG is ready" ;;
  2) warn "9. $SLUG is degraded: s3 failing (check the instance role and IMDSv2 hop limit 2)" ;;
  *) die "9. $SLUG did not become healthy; check: docker logs finerp-api-$SLUG" ;;
esac
state_record "$SLUG" "$IMAGE_TAG"

# --------------------------------------------------------------------------
# 8. Manual steps
# --------------------------------------------------------------------------
cat <<EOF

8. Remaining manual steps:
   a) API DNS record:
        cloudflared tunnel route dns finerp-singapore $API_HOST
      then confirm in the Cloudflare dashboard (zone $BASE_DOMAIN > DNS) that
      $API_HOST is a proxied CNAME to <tunnel-uuid>.cfargotunnel.com in the
      $BASE_DOMAIN zone (route dns can pick the wrong zone).
   b) Frontend domain: Cloudflare dashboard > Workers & Pages > finerp-app >
      Custom domains > Set up a custom domain > $APP_HOST
   c) Check: https://$API_HOST/readyz and sign in at https://$APP_HOST
EOF
