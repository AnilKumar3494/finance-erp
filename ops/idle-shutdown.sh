#!/usr/bin/env bash
# Power the server off once nobody has used it for IDLE_MINUTES.
#
# Usage:
#   ops/idle-shutdown.sh          (run every 2 minutes by finerp-idle.timer)
#
# "Used" means any of:
#   - cloudflared_tunnel_total_requests moved since the last check (every
#     request on every tunnel hostname: tenant APIs and kapil; Docker
#     health checks never pass through the tunnel)
#   - someone is logged in (SSH)
#   - a backup or a release is running
# The last-activity time lives in /run, so it resets at boot: a fresh boot
# always gets a full IDLE_MINUTES before it can sleep again (time for the
# startup nightly job and the catch-up timers).
#
# The instance's shutdown behaviour is "stop" (checked 2026-10-26), so a
# poweroff stops it; it does not terminate. It wakes again when a request
# reaches the Cloudflare wake Worker (ops/wake-worker/).
#
# Keep the server awake (deploys, debugging):
#   sudo touch /etc/finerp/no-sleep      (sudo rm it to allow sleep again)
#
# Install (runs from a fixed path, not from the repo, so a release merge never
# rewrites it mid-run; re-run the first line after changing this file):
#   sudo install -m 755 ops/idle-shutdown.sh /usr/local/sbin/finerp-idle-shutdown
#   sudo install -m 644 ops/systemd/finerp-idle.service ops/systemd/finerp-idle.timer /etc/systemd/system/
#   sudo systemctl daemon-reload && sudo systemctl enable --now finerp-idle.timer
#
# Check:
#   systemctl list-timers finerp-idle.timer
#   journalctl -u finerp-idle -n 20
#   cat /run/finerp-idle/last-activity
#
# Needs: curl, cloudflared with its metrics server on METRICS_URL.
set -euo pipefail

IDLE_MINUTES=${IDLE_MINUTES:-10}
METRICS_URL=${METRICS_URL:-http://127.0.0.1:20241/metrics}
NO_SLEEP_FLAG=${NO_SLEEP_FLAG:-/etc/finerp/no-sleep}
STATE_DIR=${STATE_DIR:-/run/finerp-idle}

log() { printf '%s\n' "$*"; }

mkdir -p "$STATE_DIR"
now=$(date +%s)

# mark_active <reason>: record activity now and stop.
mark_active() {
  printf '%s\n' "$now" >"$STATE_DIR/last-activity"
  log "active: $1"
  exit 0
}

[[ -e $NO_SLEEP_FLAG ]] && mark_active "$NO_SLEEP_FLAG exists"

# Without the counter we cannot tell idle from broken, so stay up.
count=$(curl -fsS --max-time 5 "$METRICS_URL" 2>/dev/null \
  | sed -n 's/^cloudflared_tunnel_total_requests \([0-9.e+]*\)$/\1/p') || true
if [[ -z $count ]]; then
  mark_active "cloudflared metrics unreadable"
fi
previous=$(cat "$STATE_DIR/request-count" 2>/dev/null || true)
printf '%s\n' "$count" >"$STATE_DIR/request-count"
[[ -f $STATE_DIR/last-activity ]] || mark_active "first check since boot"
# Any change counts: a drop means cloudflared restarted.
[[ $count != "$previous" ]] && mark_active "tunnel requests $previous -> $count"

[[ -n $(who) ]] && mark_active "login session open"

for unit in finerp-backup.service kapilcareerops-backup.service; do
  systemctl is-active --quiet "$unit" && mark_active "$unit running"
done
pgrep -f 'release\.sh' >/dev/null && mark_active "release.sh running"

last=$(cat "$STATE_DIR/last-activity")
idle_minutes=$(((now - last) / 60))
if ((idle_minutes < IDLE_MINUTES)); then
  log "idle ${idle_minutes}m of ${IDLE_MINUTES}m"
  exit 0
fi

log "idle ${idle_minutes}m, powering off"
systemctl poweroff
