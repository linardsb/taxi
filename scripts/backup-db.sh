#!/usr/bin/env bash
# Nightly pg_dump of the production database → off-box object storage (#13).
#
# Runs on the Hetzner box from the deploy user's crontab (runbook §6):
#   0 3 * * * BACKUP_RCLONE_REMOTE=r2:sakta-backups /opt/taxi/scripts/backup-db.sh >> /var/log/taxi/backup.log 2>&1
#
# Needs: the compose stack up at /opt/taxi, and `rclone` configured with an
# S3-compatible remote (Cloudflare R2 or Backblaze B2) named in
# BACKUP_RCLONE_REMOTE. Both free tiers hold years of pilot-sized dumps.
#
# A BACKUP THAT HAS NEVER BEEN RESTORED IS NOT A BACKUP. The restore rehearsal
# is runbook §6.2; do it once when this is first installed, and again after any
# Postgres major upgrade.
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/taxi}"
LOCAL_DIR="${BACKUP_LOCAL_DIR:-/var/backups/taxi}"
REMOTE="${BACKUP_RCLONE_REMOTE:?set BACKUP_RCLONE_REMOTE, e.g. r2:sakta-backups}"
# Local copies are a convenience for a fast restore; the remote is the backup.
KEEP_LOCAL_DAYS=7
KEEP_REMOTE_DAYS=30

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$LOCAL_DIR/taxi-$stamp.dump"
mkdir -p "$LOCAL_DIR"

cd "$COMPOSE_DIR"
# -Fc: pg_dump's custom format — already compressed, and the only format
# pg_restore can restore selectively. -T: stdin is not a tty under cron.
docker compose -f docker-compose.yml -f compose.prod.yml exec -T db \
  pg_dump -U taxi -d taxi -Fc > "$file"

# Structural sanity check before anything is uploaded: a dump of the wrong
# database, or an empty one, has no geozones table.
if ! pg_restore --list "$file" | grep -q 'TABLE public geozones'; then
  echo "$(date -u +%FT%TZ) backup FAILED: $file has no geozones table" >&2
  exit 1
fi

rclone copy "$file" "$REMOTE/"
rclone delete --min-age "${KEEP_REMOTE_DAYS}d" "$REMOTE/"
find "$LOCAL_DIR" -name 'taxi-*.dump' -mtime +"$KEEP_LOCAL_DAYS" -delete

echo "$(date -u +%FT%TZ) backup ok $file $(stat -c %s "$file") bytes → $REMOTE"
