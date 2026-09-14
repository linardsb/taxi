# Implementation Report — encrypt dumps at rest on R2 (rclone crypt)

**Plan**: none — issue #149's body plus its 2026-09-12 comments (bucket, token and custody decision) are the plan, as the issue says.   **Branch**: `fix/backup-crypt-149`   **Status**: PARTIAL — the repo side is complete; the on-box configuration and the two R2 "done when" checks need the passphrase and the token, which live in the password manager, not in this session.

## Summary

The nightly dump now goes to an rclone `crypt` remote (`r2crypt:`) that wraps the plain `r2:sakta-backups` remote, so content and file names are encrypted on the box before upload and only a machine with the passphrase can list or read them. `scripts/backup-db.sh` needed no logic change — only its header and the `BACKUP_RCLONE_REMOTE` example now name `r2crypt:`. Runbook §6.1 documents the second `rclone config` step, where both secrets live (the "Sakta R2 backups" password-manager entry plus a printed passphrase at home), the no-salt decision, the obscured-not-encrypted `rclone.conf`, and the two-sided `rclone lsf` check. §6.2 now rehearses the restore from a machine that is not the box, starting from only that entry.

## Tasks completed

- Script header, "Needs" paragraph and `:?` example → `scripts/backup-db.sh` (UPDATE)
- §6.1 Install: crypt remote, custody, `rclone.conf` warning, drop `rclone mkdir`, cron line, two-sided listing check, crypt overhead figure → `docs/runbooks/hetzner-deploy.md` (UPDATE)
- §6.2 Restore rehearsal: crypt source, laptop-first from the password-manager entry, provenance paragraph, plaintext clean-up line → `docs/runbooks/hetzner-deploy.md` (UPDATE)
- Intro sentence and §5.2's by-hand backup line name the encrypted remote → `docs/runbooks/hetzner-deploy.md` (UPDATE)

## Tests added

None in the repo: no package is touched, so nothing for jest or vitest to run. Validation was done by running the real thing locally, see below.

## Validation results

All `observed` 2026-09-12, rclone v1.75.1 (binary downloaded into the scratchpad, not installed), on the local checkout at the branch head.

**Local reproduction of the issue's two "done when" checks**, with a `crypt` remote wrapping a scratchpad directory in place of `r2:sakta-backups` (`crypt-test.sh`):

| Check | Result |
|---|---|
| `rclone copy file r2crypt:/` and `rclone delete --min-age 30d r2crypt:/` — the script's exact `"$REMOTE/"` shape | exit 0 |
| `rclone lsf r2crypt:` | `taxi-20260912T030000Z.dump` |
| `rclone lsf` on the plain side | `s7qk2tokete3640lp5ctrqs0ct3qe3dbulq8tqodhqq09bhks100` |
| plaintext grep inside the stored object | no match; 64 bytes stored for a 16-byte file (32-byte header + 16 + 16-byte tag, rclone's documented format) |
| second `rclone.conf` built from scratch with only the passphrase, `rclone copy "r2crypt:$(rclone lsf r2crypt: \| sort \| tail -1)"` | byte-identical (`cmp` exit 0) |
| `rclone config create` file mode | 0600 |

**`scripts/backup-db.sh` end to end** under the #147 reviews' shim set (`docker` answering `exec -T db pg_dump` and `exec -T db pg_restore --list` with a 300 000-line listing, geozones on line 42; `stat -c %s` mapped to `stat -f %z`), real rclone, `BACKUP_RCLONE_REMOTE=r2crypt:` (`script-run.sh`): exit 0, log line `backup ok … 21 bytes → r2crypt:`, local dump 0600, crypt side lists both real names, plain side two base32 names, no plaintext in either object.

`bash -n scripts/backup-db.sh`: clean.

**Gate** `pnpm turbo run typecheck lint test build --force` from cleared `dist`/`.next`, `REDIS_TEST_URL=redis://localhost:6381` (the running `taxi-redis-1` port), `COMPOSE_PROJECT_NAME=taxi`: exit 0, `Tasks: 22 successful, 22 total`, 82 s; `@taxi/api` `Test Suites: 77 passed, 77 total`, `Tests: 724 passed, 724 total` (no skipped suites — the Redis-gated ones ran). The diff touches no turbo package input, so this result cannot depend on the change; CI re-runs it on the PR.

**Not observed — needs the box and the two secrets** (`expected`, runbook §6.1/§6.2):

- `rclone lsf r2crypt:` lists the dumps by their real names and `rclone lsf r2:sakta-backups` does not — on the box, after the two `rclone config` steps and one by-hand run. Paste both outputs into the PR body; the issue's first "done when".
- §6.2's rehearsal from the laptop, starting from only the "Sakta R2 backups" entry — the issue's second "done when". Log date, machine and counts in §7.

## Deviations from the plan

- **D1 — the R2 checks are reproduced, not run.** The issue's "done when" wants their observed output in the PR body. There is no box yet (runbook §7: "Nothing has been deployed at the time of writing"), and the passphrase and token are in the password manager only. Both checks were reproduced against a local directory with the same rclone commands; the on-box run is listed above as the remaining step, and the PR body must say `expected` for those two lines until Linards pastes the output.
- **D2 — `rclone mkdir r2:sakta-backups` removed from §6.1.** The bucket exists since 2026-09-12 (wrangler, per the issue), and the box's token is Object Read & Write scoped to that bucket, which per Cloudflare's token scopes cannot create buckets. The runbook says to recreate with wrangler if it is ever gone.
- **D3 — §6.2 rehearses from the laptop, not "on the box".** The issue's second "done when" asks for a restore on a machine that only has the passphrase and the token; the box would have `rclone.conf` already and prove nothing about the password-manager entry. The box variant stays as a one-line alias comment in the same block.
- **D4 — nothing under `test/`.** The change is a shell script's comments and a runbook; the validation is the shim run and the crypt reproduction above rather than a jest spec.

## Issues encountered

- The PreToolUse hook blocked reading `~/.ssh/config` (to see whether a box host exists) and the hook source itself; neither was needed.
- Latest migration on this branch: `db/migrations/0010_smooth_white_queen.sql` (no migration in this ticket).
- Local checkout was on `feature/no-model-pr-gate`, PR #167 merged 2026-09-10; the branch was cut from fast-forwarded `main` at `d5bbea1`.
