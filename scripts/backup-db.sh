#!/usr/bin/env bash
# Nightly pg_dump of the production database → off-box object storage (#13).
#
# Runs on the Hetzner box from the deploy user's crontab (runbook §6):
#   0 3 * * * BACKUP_RCLONE_REMOTE=r2crypt: /opt/taxi/scripts/backup-db.sh >> /var/log/taxi/backup.log 2>&1
#
# Needs: the compose stack up at /opt/taxi, and `rclone` configured with a
# `crypt` remote wrapping the S3-compatible bucket (Cloudflare R2), named in
# BACKUP_RCLONE_REMOTE. A dump is every rider's and driver's name, phone number
# and address, so it is encrypted on the box before it leaves (#149): the
# bucket holds ciphertext under encrypted names, and only a machine with the
# passphrase (runbook §6.1) can list or read it. Point this at the plain `r2`
# remote and the dump goes up readable. The free tier holds years of
# pilot-sized dumps.
#
# A BACKUP THAT HAS NEVER BEEN RESTORED IS NOT A BACKUP. The restore rehearsal
# is runbook §6.2; do it once when this is first installed, and again after any
# Postgres major upgrade.
set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/taxi}"
LOCAL_DIR="${BACKUP_LOCAL_DIR:-/var/backups/taxi}"
REMOTE="${BACKUP_RCLONE_REMOTE:?set BACKUP_RCLONE_REMOTE, e.g. r2crypt:}"
# Local copies are a convenience for a fast restore; the remote is the backup.
KEEP_LOCAL_DAYS=7
KEEP_REMOTE_DAYS=30

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$LOCAL_DIR/taxi-$stamp.dump"
# 077 before anything is created: a dump is riders, drivers, phone numbers and
# the ledger, and cron's default umask (022) would write every one of them
# 0644 — readable by any local account. Covers this `mkdir` and every dump
# below; an already-created $LOCAL_DIR is chmod 700'd by runbook §1.3.
umask 077
mkdir -p "$LOCAL_DIR"

# A run that fails part-way must not leave a truncated dump under the real
# name: `set -e` alone would exit with the partial file in place, and the
# `ls -t | head -1` restore idiom (runbook §6.2) would pick it as the newest.
# Once the dump has passed the structural check below it is worth keeping, so
# `dump_validated` flips this trap from remove to log-only: a later failure
# (rclone's token expired, the network went) must LEAVE the file — §6.1's
# "local copies are a convenience for a fast restore" is the whole point — and
# must still write one line naming this script, its exit code and the dump,
# because the cron log (`>> /var/log/taxi/backup.log`) is the only signal
# there is and nobody greps for the ABSENCE of the "backup ok" line.
dump_validated=0
cleanup() {
  local status=$?
  if [ "$status" -eq 0 ]; then return 0; fi
  if [ "$dump_validated" -eq 1 ]; then
    echo "$(date -u +%FT%TZ) backup FAILED after the dump passed (exit $status): kept $file" >&2
  else
    rm -f -- "$file"
    echo "$(date -u +%FT%TZ) backup FAILED (exit $status): removed $file" >&2
  fi
}
trap cleanup EXIT

cd "$COMPOSE_DIR"
# -Fc: pg_dump's custom format — already compressed, and the only format
# pg_restore can restore selectively. -T: stdin is not a tty under cron.
docker compose -f docker-compose.yml -f compose.prod.yml exec -T db \
  pg_dump -U taxi -d taxi -Fc > "$file"

# Structural sanity check before anything is uploaded: a dump of the wrong
# database, or an empty one, has no geozones table. Read back INSIDE the db
# container, where the dump was made — a host-side `pg_restore` silently
# couples the backup to the host client's major being >= the image's, and on
# the first Postgres major upgrade it fails on the archive header, takes the
# branch below while the trap is still on its remove path, and deletes a
# perfectly good dump every night while logging a message about geozones.
# grep reads the WHOLE listing, so no `-q`: `grep -q` exits at its first
# match, pg_restore then takes SIGPIPE on its next write, `pipefail` reports
# 141, and a valid dump reads as "no geozones table".
if ! docker compose -f docker-compose.yml -f compose.prod.yml exec -T db \
    pg_restore --list < "$file" | grep 'TABLE public geozones' >/dev/null; then
  echo "$(date -u +%FT%TZ) backup FAILED: $file has no geozones table" >&2
  exit 1
fi
# The trap's remove branch was for the half-written dump, and its job is done.
# A dump that FAILS the check is still removed, deliberately: it is not a
# backup, and the restore idiom must not pick it.
dump_validated=1

rclone copy "$file" "$REMOTE/"
rclone delete --min-age "${KEEP_REMOTE_DAYS}d" "$REMOTE/"
find "$LOCAL_DIR" -name 'taxi-*.dump' -mtime +"$KEEP_LOCAL_DAYS" -delete

echo "$(date -u +%FT%TZ) backup ok $file $(stat -c %s "$file") bytes → $REMOTE"
