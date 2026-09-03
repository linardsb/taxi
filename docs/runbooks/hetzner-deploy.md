# Runbook — the Hetzner environment (#13)

One Hetzner CX22 runs the API, Postgres+PostGIS and Redis from the repo's own
`docker-compose.yml` plus the `compose.prod.yml` overlay, behind Caddy and the
Cloudflare proxy. Deploys are a manual GitHub Actions run. Migrations run on
every deploy; the Rīga seed runs once, by hand. Backups are a nightly `pg_dump`
to off-box object storage, **and a restore has to be rehearsed** (§6.2).

A reader should be able to provision a second box from this document alone.
Where a figure appears it is labelled `observed` (a run or invoice produced
it — named), `derived` (arithmetic shown, condition stated) or `expected` (not
yet run), per the root `CLAUDE.md` rule.

Sources of truth this document defers to: `compose.prod.yml` (the stack),
`services/api/Dockerfile` (the image), `.github/workflows/deploy.yml` (the
deploy), `scripts/backup-db.sh` (the backup),
`services/api/src/common/config/env.schema.ts` (every variable and every
production gate), and the plan `.claude/plans/deploy-hetzner-environment.md`.
Hosting decision and its reasoning: `docs/epics/sakta-cab.architecture.md` →
*Hosting decision revised (2026-08-16)*; cost evidence:
`docs/research/hosting-sms-cost-research.md`.

## 0 · What runs where

```
phone / driver app ──https──▶ Cloudflare proxy ──https (Origin CA cert)──▶ Caddy :443 ──http──▶ api :3001
                                                                                                  ├──▶ db    (Postgres 16 + PostGIS 3.4, compose network only)
                                                                                                  └──▶ redis (7, compose network only)
```

| Service | Image | Reachable from | Persistent data |
|---|---|---|---|
| `caddy` | `caddy:2-alpine` | the internet, 80 + 443 | `caddy-data`, `caddy-config` volumes (nothing precious) |
| `api` | `ghcr.io/linardsb/taxi-api:<tag>` | `caddy` only | none |
| `db` | `postgis/postgis:16-3.4-alpine` | `api` only | `db-data` volume — **the only thing that matters** |
| `redis` | `redis:7-alpine` | `api` only | none (presence, live positions, idempotency keys — all rebuilt or expired) |

On the box, everything lives in `/opt/taxi`:

```
/opt/taxi/
  docker-compose.yml     ← from the repo, synced by every deploy
  compose.prod.yml       ← from the repo, synced by every deploy
  Caddyfile              ← from the repo, synced by every deploy
  scripts/backup-db.sh   ← from the repo, synced by every deploy
  .env                   ← hand-written, NEVER in the repo (§3)
  certs/origin.pem       ← Cloudflare Origin CA certificate (§2.3)
  certs/origin.key
```

`ufw` does **not** filter Docker-published ports (Docker writes its own
iptables chain ahead of ufw's). That is why the overlay *removes* the 5432 and
6379 publishes rather than relying on the firewall to hide them.

## 1 · Provision the box (once)

### 1.1 Create it

Hetzner Cloud console → new server:

- **Type** CX22 (2 vCPU / 4 GB / 40 GB NVMe), x86 — not the ARM CAX line; OSRM
  (#134) publishes amd64-only images.
- **Location** Falkenstein or Helsinki.
- **Image** Ubuntu 24.04.
- **Networking** IPv4 **and** IPv6. IPv4 costs ~€0.60/mo extra (`observed`
  vendor page 2026-08-14, research §3) and was taken deliberately for the
  first deploy: IPv6-only saves that but makes SSH from an IPv4-only network
  impossible, and a lockout on day one costs more than a year of the saving.
  Revisit once the box is boring.
- **SSH key** your own public key. Password login is disabled in 1.2.

**Record the actual monthly price at purchase in §7.** The €4.49 in this
document is `observed` from Hetzner's page on 2026-08-14; Hetzner adjusted
prices twice in 2026.

### 1.2 Harden it

As root, first login:

```bash
adduser --disabled-password --gecos '' deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh && chmod 600 /home/deploy/.ssh/authorized_keys
echo 'deploy ALL=(ALL) NOPASSWD:ALL' > /etc/sudoers.d/deploy

# SSH: key-only, no root. A drop-in, not a sed on sshd_config: Ubuntu 24.04's
# file opens with `Include /etc/ssh/sshd_config.d/*.conf` and sshd keeps the
# FIRST value it reads, so an edit lower down loses to whatever cloud-init
# dropped in there; `00-` sorts ahead of all of them.
printf 'PasswordAuthentication no\nPermitRootLogin no\n' > /etc/ssh/sshd_config.d/00-hardening.conf
systemctl restart ssh
sshd -T | grep -Ei '^(passwordauthentication|permitrootlogin) '   # both must read `no` before you close this shell

# Firewall: 22, 80, 443 and nothing else
apt-get update && apt-get install -y ufw unattended-upgrades
ufw default deny incoming && ufw default allow outgoing
ufw allow 22/tcp && ufw allow 80/tcp && ufw allow 443/tcp
ufw --force enable
dpkg-reconfigure -f noninteractive unattended-upgrades
```

Open a **second** terminal and confirm `ssh deploy@<ip>` works before closing
the root one.

### 1.3 Docker

As `deploy`:

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker deploy
# log out and back in, then:
docker run --rm hello-world
docker compose version          # needs ≥ 2.24 for the `!reset` tag in compose.prod.yml
sudo mkdir -p /opt/taxi/scripts /opt/taxi/certs /var/backups/taxi /var/log/taxi
sudo chown -R deploy:deploy /opt/taxi /var/backups/taxi /var/log/taxi
```

### 1.4 The deploy key (for GitHub Actions)

On your Mac, a key pair used only by the workflow:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/taxi-deploy -N '' -C 'github-actions deploy'
ssh-copy-id -i ~/.ssh/taxi-deploy.pub deploy@<ip>
ssh-keyscan -H <ip>                 # → the SSH_KNOWN_HOSTS secret, verbatim
```

Then in GitHub → repo → Settings → Secrets and variables → Actions:

| Secret | Value |
|---|---|
| `SSH_HOST` | the box's public IPv4 |
| `SSH_KEY` | the contents of `~/.ssh/taxi-deploy` (the private key) |
| `SSH_KNOWN_HOSTS` | the `ssh-keyscan -H` output — pinned so a changed host key fails the run |
| `GHCR_TOKEN` | a classic PAT with `read:packages` — the box uses it to pull the private image |

And one **variable** (not a secret): `API_DOMAIN` = `api.<your domain>`, used
by the workflow's final health check. Leave it unset until §2 is done; the
step skips itself.

## 2 · Domain and Cloudflare (once)

### 2.1 The domain

Buy a **short** one — `sakta.lv`-length, not `saktacab.lv`-length. #136 needs
the linked SMS at one segment, and at 59 characters there are 11 to spare;
choosing a long domain now makes that lever impossible without a second
migration. Add the zone to Cloudflare (free plan) and point the registrar's
nameservers at it.

### 2.2 DNS

| Record | Name | Value | Proxy |
|---|---|---|---|
| A | `api` | the box's IPv4 | **on** (orange cloud) |
| AAAA | `api` | the box's IPv6 | **on** |

The tracking page's hostname (`PUBLIC_TRACKING_BASE_URL`, §3) is the dispatch
app's, which #18/#19 deploy. Whatever you set there **404s until then** — known
and accepted; it exists now because the schema refuses localhost in production.

### 2.3 TLS — Origin CA certificate, mode Full (strict)

Cloudflare → SSL/TLS:

1. **Overview** → encryption mode **Full (strict)**.
2. **Origin Server** → *Create Certificate* → RSA 2048, hostnames `api.<domain>`
   (add `*.<domain>` if you want one cert for the tracking host later), 15
   years. Copy the certificate to `/opt/taxi/certs/origin.pem` and the private
   key to `/opt/taxi/certs/origin.key` on the box; `chmod 600` both.
3. **Edge Certificates** → *Always Use HTTPS* on.

Why this and not the alternatives is in the `Caddyfile` header: Flexible mode
would carry OTP codes and JWTs Cloudflare → Hetzner in the clear, and ACME
through the proxy is fragile. The origin cert is trusted by exactly one client,
Cloudflare, which is the only client that ever reaches port 443.

Anyone who knows the IP can still hit the origin directly (they get a
certificate warning, not a refusal). Restricting 443 to Cloudflare's published
IP ranges in `ufw` closes that; not done for the first deploy — one more thing
to get wrong on day one — and worth doing before the pilot opens.

### 2.4 WebSockets

Cloudflare → Network → *WebSockets* on (it is on by default on the free plan).
`expected`: Cloudflare closes proxied connections idle for ~100 s, and
Socket.IO's server ping every 25 s (its default `pingInterval`) keeps a
connection non-idle. **This is an expectation, not an observation** — §8.2
holds a real connection open for longer than a minute through the proxy, and
that run is what turns it into one.

## 3 · The host `.env`

Hand-written at `/opt/taxi/.env`, `chmod 600`, never committed. Compose reads
it for the `${…}` substitutions in `compose.prod.yml` **and** hands the whole
file to the `api` container. `DATABASE_URL` and `REDIS_URL` are deliberately
**not** in it — the overlay composes them from `POSTGRES_PASSWORD` and the
compose hostnames, so the database password lives in one place.

| Variable | Value | Why |
|---|---|---|
| `POSTGRES_PASSWORD` | `openssl rand -hex 16` | Read by `initdb` on the volume's **first** start only. To change it later: `ALTER ROLE taxi PASSWORD '…'` in psql, then edit here, then `up -d`. |
| `API_DOMAIN` | `api.<domain>` | The one placeholder the `Caddyfile` reads. |
| `API_IMAGE_TAG` | written by the workflow | Which image `up` starts. Rollback = edit this, `up -d api` (§5.2). |
| `API_PORT` | `3001` | Must match the healthcheck in `compose.prod.yml` and `reverse_proxy api:3001` in the `Caddyfile`. |
| `JWT_SECRET` | `openssl rand -hex 32` | **Production refuses** the committed dev value, anything under 32 chars, and equality with `OTP_PEPPER`. A published signing key mints `admin` tokens with no revocation. |
| `OTP_PEPPER` | `openssl rand -hex 32`, **different** | Peppers OTP hashes and nothing else, so rotating the JWT key does not invalidate every OTP in flight. |
| `JWT_EXPIRES_IN` | `30d` | Schema default; listed so it is a decision, not an accident. |
| `DEFAULT_CITY_ID` | `00000000-0000-4000-8000-000000000001` | Rīga, as seeded. Dispatchers join `dispatch:<this>`. |
| `CORS_ORIGINS` | `https://<dispatch app origin>` | Single source of truth for REST **and** the Socket.IO handshake. A missing origin fails the handshake in a way that looks like an auth error. Native apps do not send an Origin; the dispatch app's browser does. |
| `PUBLIC_TRACKING_BASE_URL` | `https://<tracking host>` | Where SMS tracking links point. **Production refuses localhost.** 404s until #18/#19. |
| `PUSH_PROVIDER` | `expo` | **Required in production** (#14): the push factory refuses to boot on the stub, which delivers nothing — a driver whose app was force-quit would never get the "you've gone offline" nudge. Expo's push API needs no credential, so this value is the whole switch. |
| `EXPO_PUSH_ACCESS_TOKEN` | empty | Optional: Expo's "enhanced push security" token, sent as a Bearer on every push. Empty reads as unset. |
| `ALLOW_STUB_MAPS_PROVIDER` | `true` | **The one documented relaxation** (#13). Quotes are straight-line × 1.35 and there is no polyline until #134 binds OSRM and deletes this variable. Safe only while no Stripe key is set and the pilot is closed — if either changes before #134, unset it and let the deploy fail. Literal `true`/`false` only. |
| `GOOGLE_MAPS_API_KEY` | a Maps Platform key with *Places API (New)* enabled | **Required in production** even with the switch on: the switch accepts straight-line quotes, not a dead address typeahead (#19). Google's free monthly credit covers pilot volume; re-check before opening the pilot. |
| `MAPS_ROUTE_CACHE_TTL_SECONDS` … `MAPS_PLACE_CACHE_TTL_SECONDS`, `PLACES_*` | omit → schema defaults | The spend knobs. Defaults are the pilot's; `env.schema.ts` explains each. |
| `TWILIO_ACCOUNT_SID` | `AC…` from console.twilio.com | **All three or none — the schema refuses a partial trio in every environment.** A **trial** account is enough for testing: it sends only to numbers verified in the console (Atis, Dina, Linards) and the sender must be the trial number. Paid account + alphanumeric sender (`SaktaCab`) before the pilot opens (#137). |
| `TWILIO_AUTH_TOKEN` | the auth token | |
| `TWILIO_FROM_NUMBER` | the trial number, E.164 (`+371…`) | |
| `STRIPE_SECRET_KEY` | **leave empty** | Cash-only pilot: no SIA, no key. Empty binds `CardPaymentsDisabledProvider`, which **refuses** every card charge (§9). A `sk_live_…` is refused at boot in every environment. |
| `STRIPE_WEBHOOK_SECRET` | empty | Unused (no webhooks). |

A template to copy:

```dotenv
POSTGRES_PASSWORD=
API_DOMAIN=api.example.lv
API_PORT=3001
JWT_SECRET=
OTP_PEPPER=
JWT_EXPIRES_IN=30d
DEFAULT_CITY_ID=00000000-0000-4000-8000-000000000001
CORS_ORIGINS=https://dispatch.example.lv
PUBLIC_TRACKING_BASE_URL=https://dispatch.example.lv
PUSH_PROVIDER=expo
EXPO_PUSH_ACCESS_TOKEN=
ALLOW_STUB_MAPS_PROVIDER=true
GOOGLE_MAPS_API_KEY=
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_FROM_NUMBER=
STRIPE_SECRET_KEY=
STRIPE_WEBHOOK_SECRET=
```

Every one of these gates was exercised against the built image on a laptop
before a server existed (§8.3) — a wrong value fails the container at boot with
a message naming the variable, and `up -d --wait` fails the deploy.

## 4 · First deploy

1. §1–§3 done: the box answers `ssh deploy@<ip> docker ps`, `/opt/taxi/.env`
   and `/opt/taxi/certs/` are in place, the four Actions secrets exist.
2. Trigger the workflow from a checkout of `main`:

   ```bash
   gh workflow run deploy.yml --ref main
   gh run watch
   ```

   It builds the image for `linux/amd64`, pushes `ghcr.io/linardsb/taxi-api`
   tagged `sha-<12 chars>` and `latest`, copies the four compose files to
   `/opt/taxi`, then on the box: `docker login ghcr.io`, `pull`, **migrate
   with the new image**, `up -d --wait`, reloads Caddy, records
   `API_IMAGE_TAG` in `.env`, prunes every image no container uses. The first
   run also creates the `db-data` volume and runs `initdb` with
   `POSTGRES_PASSWORD`.
3. **Seed once, by hand:**

   ```bash
   ssh deploy@<ip>
   cd /opt/taxi
   docker compose -f docker-compose.yml -f compose.prod.yml run --rm api node node_modules/@taxi/db/dist/seed/run.js
   ```

   Why once and never on deploy: `seedRiga()` is idempotent, but its
   `platform_config` upsert **re-asserts `commissionPct = 15` and the €50 debt
   limit** on conflict — so an automated re-seed would stomp an admin's edit the
   day #20's config editor exists. `dispatchPhone` is deliberately excluded from
   that conflict set for the same reason. Re-running by hand is fine and is the
   documented way to correct a hand-edited row.
4. Verify with §8. Then set the `API_DOMAIN` repo variable so future runs
   check `/health` from the outside themselves.

## 5 · Routine deploy, rollback, by-hand operations

### 5.1 Deploy

Merge to `main`, then `gh workflow run deploy.yml --ref main`. Manual on
purpose: auto-deploy on merge is a decision for after the first hand-triggered
run has succeeded, and CI does not exercise a production boot. When a run
fails, the step name says which half: **build** (the Dockerfile — reproduce
with `docker build -f services/api/Dockerfile .` locally) or **deploy** (the
box — `ssh` in and read `docker compose … logs api`).

Migrations are **forward-only**: the runner applies what `db/migrations` holds
and nothing undoes one. A migration that fails leaves the previous API running
(the `up` never happens) — fix forward.

The `Caddyfile` is bind-mounted and Caddy reads it at start only; `up` does
not recreate a service because a mounted file's *content* changed. The
workflow therefore runs `caddy reload` after `up` — zero-downtime, a no-op
when the file is unchanged. A Caddyfile edited by hand on the box needs the
same command (§5.3).

### 5.2 Rollback

Every deployed image stays on ghcr.io under its `sha-…` tag. The box does
**not** keep the previous one: each deploy ends with `docker image prune -af`,
which removes every image no container is using, so a rollback is a re-pull
(the `pull` below), not a local switch. To go back one deploy:

```bash
cd /opt/taxi
sed -i 's/^API_IMAGE_TAG=.*/API_IMAGE_TAG=sha-<previous>/' .env     # the previous run's tag is in its Actions log
docker compose -f docker-compose.yml -f compose.prod.yml pull api
docker compose -f docker-compose.yml -f compose.prod.yml up -d --wait api
```

If the deploy being rolled back **also shipped a migration**, the old code
runs against the new schema. Additive migrations (a new nullable column, a new
table) are fine; a destructive one is not, and the honest rollback is a restore
from the backup taken before the deploy (§6.3). Take one by hand before any
migration that drops or renames: `BACKUP_RCLONE_REMOTE=… scripts/backup-db.sh`.

### 5.3 By hand on the box

```bash
cd /opt/taxi
alias dc='docker compose -f docker-compose.yml -f compose.prod.yml'
dc ps                              # what is running, and health
dc logs -f --tail 200 api          # structured JSON events (see .claude/references/logging-standard.md)
dc restart api
dc exec db psql -U taxi -d taxi    # the database
dc run --rm api node node_modules/@taxi/db/dist/migrate-run.js   # migrate without a deploy (no-op when current)
dc exec -T caddy caddy reload --config /etc/caddy/Caddyfile        # after a by-hand Caddyfile edit; the deploy does this itself
```

## 6 · Backups and restore

Redis is not backed up: presence, live positions and idempotency keys are
rebuilt or expire, and every piece of dispatch state is a `ride_offers` row in
Postgres, so a restart strands nothing. **Postgres is the ledger** — rides and
money — and it is backed up nightly, off the box.

### 6.1 Install

On the box, as `deploy`:

```bash
sudo apt-get install -y rclone postgresql-client     # pg_restore for the script's sanity check
rclone config                                        # new remote → s3 → provider Cloudflare (R2) → your R2 API token; name it r2
rclone mkdir r2:sakta-backups
crontab -e
```

Add:

```
0 3 * * * BACKUP_RCLONE_REMOTE=r2:sakta-backups /opt/taxi/scripts/backup-db.sh >> /var/log/taxi/backup.log 2>&1
```

Then run it once by hand and read the log line. What the script does:
`pg_dump -Fc` inside the `db` container → `/var/backups/taxi/taxi-<UTC stamp>.dump`
→ refuses to upload a dump with no `geozones` table → `rclone copy` to the
remote → prunes remote copies older than 30 days and local ones older than 7.
Cloudflare R2's free tier (10 GB) holds years of dumps at pilot size —
`observed` 57 KB for a 24-ride development database (§6.2).

### 6.2 Restore rehearsal — do this once, then after any Postgres upgrade

**A backup that has never been restored is not a backup.** The rehearsal below
was run on 2026-08-25 against the local compose Postgres with the same image
tag, dump format and restore flags (`observed`): a 57 015-byte dump, `pg_restore`
exit 0, restored counts identical to the source (4 geozones, 24 rides, 10
applied migrations), `PostGIS_Full_Version()` answering `3.4.3`. Repeat it on
the box:

```bash
cd /opt/taxi
alias dc='docker compose -f docker-compose.yml -f compose.prod.yml'
rclone copy "r2:sakta-backups/$(rclone lsf r2:sakta-backups | sort | tail -1)" /tmp/
dump=$(ls -t /tmp/taxi-*.dump | head -1)
dc exec -T db psql -U taxi -d postgres -c 'CREATE DATABASE taxi_restore'
dc exec -T db pg_restore -U taxi -d taxi_restore --no-owner < "$dump"
dc exec -T db psql -U taxi -d taxi_restore -c 'SELECT count(*) FROM geozones'        # → 4
dc exec -T db psql -U taxi -d taxi_restore -c 'SELECT count(*) FROM rides'           # → matches production
dc exec -T db psql -U taxi -d postgres -c 'DROP DATABASE taxi_restore'
```

Record the date and the counts in §7's log.

### 6.3 A real restore

Only after §6.2 has been done at least once. Stops the API — nothing writes
while the database is replaced:

```bash
cd /opt/taxi
alias dc='docker compose -f docker-compose.yml -f compose.prod.yml'
dc stop api caddy
dc exec -T db psql -U taxi -d postgres -c 'DROP DATABASE taxi' -c 'CREATE DATABASE taxi'
dc exec -T db pg_restore -U taxi -d taxi --no-owner < /tmp/taxi-<stamp>.dump
dc run --rm api node node_modules/@taxi/db/dist/migrate-run.js   # no-op if the dump is current; applies anything newer
dc up -d --wait
```

Then §8.1. Rides that happened after the dump was taken are gone; say so in the
support thread if a driver asks about one.

## 7 · Spend, against the <€100/mo guardrail

### Derived — before the first invoice

Rates `observed` from vendor pages on 2026-08-14 (research §3, §5.2); totals
`derived` here. Conditions: **IPv4 taken** (§1.1 — the research's €5.49 assumed
IPv6-only), no paid maps provider (the stub behind the switch until #134, then
self-hosted OSRM at €0 marginal), Twilio **trial** (€0) through testing, no
Hetzner backup add-on (`pg_dump` to R2's free tier instead), Cloudflare free
plan.

| Line | €/mo | Provenance |
|---|---|---|
| CX22 | 4.49 | `observed` 2026-08-14, Hetzner pricing page |
| Primary IPv4 | 0.60 | `observed` 2026-08-14 ("~€0.60", research §3) |
| Domain | ~1.00 | `derived`, research §5.2 (annual price ÷ 12) |
| Backups (R2 free tier), Cloudflare, Twilio trial | 0 | free tiers as of 2026-08-14 |
| **Infra total, testing phase** | **≈ 6.09** | `derived`: 4.49 + 0.60 + 1.00 |
| **Pilot all-in, both SMS levers (#135, #136)** | **≈ 21.24** | `derived`: 6.09 + 15.15 (research §4.3, month-3 target rate — the busiest month, not the average) |
| **Pilot all-in, no levers** | **≈ 47.98** | `derived`: 6.09 + 41.89 (same source) |

The guardrail is not the binding constraint at any phase. SMS is the largest
line item and the only component that cannot run on our own hardware. VAT is
whatever the vendor pages showed on 2026-08-14 — re-observe at purchase.

### Observed — from invoices

**No invoice yet.** Nothing has been deployed at the time of writing
(2026-08-25). Replace this paragraph with the first full month's Hetzner
invoice and Twilio usage, dated, and keep the derived table above as the
prediction it was measured against.

| Date | Item | Value | Source |
|---|---|---|---|
| — | — | — | — |

Also log here: the price shown at purchase (§1.1), the restore rehearsal
(§6.2), and the >60 s Socket.IO hold (§8.2) — three `observed` facts this
document cannot contain until someone produces them.

## 8 · Verify — the acceptance criteria

### 8.1 Health and Socket.IO from OUTSIDE the LAN

From a phone on cellular (not Wi-Fi), or a remote shell:

```bash
curl -fsS https://api.<domain>/health          # → {"status":"ok","service":"api"}
```

Socket.IO connect through the proxy (from any machine with `socket.io-client`,
e.g. `services/api` after `pnpm install`):

```bash
node -e "const io=require('socket.io-client');const s=io('https://api.<domain>',{transports:['websocket']});s.on('connect',()=>{console.log('connected',s.id);process.exit(0)});s.on('connect_error',e=>{console.error(e.message);process.exit(1)});setTimeout(()=>{console.error('timeout');process.exit(1)},10000)"
```

A `connect_error` that reads like an auth failure is usually `CORS_ORIGINS`
(§3) — the adapter enforces it on the handshake.

### 8.2 The connection survives the proxy's idle limit

```bash
node -e "const io=require('socket.io-client');const s=io('https://api.<domain>',{transports:['websocket']});const t0=Date.now();s.on('connect',()=>console.log('connected'));s.on('disconnect',r=>{console.error('disconnected after',Math.round((Date.now()-t0)/1000),'s:',r);process.exit(1)});setTimeout(()=>{console.log('held',Math.round((Date.now()-t0)/1000),'s');process.exit(0)},90000)"
```

`held 90 s` turns §2.4's `expected` into `observed`; log it in §7.

### 8.3 Migrations, seed, and the gates

```bash
cd /opt/taxi && alias dc='docker compose -f docker-compose.yml -f compose.prod.yml'
dc exec db psql -U taxi -d taxi -c 'SELECT PostGIS_Full_Version();'
dc exec db psql -U taxi -d taxi -c 'SELECT count(*) FROM geozones;'              # → 4
dc exec db psql -U taxi -d taxi -c 'SELECT commission_pct FROM platform_config;'  # → 15
dc run --rm api node node_modules/@taxi/db/dist/migrate-run.js                    # → "Migrations up to date", exit 0
```

Gates — each of these must **fail the container at boot** (`up -d --wait`
exits non-zero, `dc logs api` names the variable). All seven were `observed`
on 2026-09-03 against the image built from PR #147's round-1 fix commit,
before any server existed. The first six were also observed on 2026-08-25; the
seventh, `PUSH_PROVIDER`, reached `main` with #14 on 2026-08-31 and the rebase
inherited the 2026-08-25 boot without re-running it — the review caught it
(round 1, F1). **After any base move, boot the image again; the gate never
runs under `NODE_ENV=production` and cannot see a new one of these.**

| Break | Expected refusal |
|---|---|
| `JWT_SECRET=dev-only-change-me` | `JWT_SECRET is the value committed to .env.example and is public` |
| `ALLOW_STUB_MAPS_PROVIDER` unset | `No production MapsProvider is bound: StubMapsProvider prices rides off straight-line distance … (set ALLOW_STUB_MAPS_PROVIDER=true …)` |
| `PUBLIC_TRACKING_BASE_URL=http://localhost:3000` | `PUBLIC_TRACKING_BASE_URL is a localhost origin` |
| two of three `TWILIO_*` | `TWILIO_FROM_NUMBER is missing: TWILIO_* must be set all together or not at all` |
| no `TWILIO_*` at all | `No production SmsProvider is bound` |
| `GOOGLE_MAPS_API_KEY` unset (switch on) | `No production MapsProvider is bound: no GOOGLE_MAPS_API_KEY is set` |
| `PUSH_PROVIDER` unset | `No production PushProvider is bound: StubPushProvider delivers nothing. Set PUSH_PROVIDER=expo (#14) …` |

And one that must **not** be a boot failure: with `STRIPE_SECRET_KEY` empty,
the API boots and a card settlement answers **502 `payment_provider_error`**,
never 201 — see §9.

## 9 · Known-broken and accepted for this deploy

| What | Why | Until |
|---|---|---|
| `/t/:token` links 404 | The dispatch app is not deployed; `PUBLIC_TRACKING_BASE_URL` had to be a real hostname because the schema refuses localhost | #18/#19 |
| Quotes are straight-line × 1.35, no polyline | `ALLOW_STUB_MAPS_PROVIDER=true` | #134 |
| **Card rides cannot settle** | Cash-only pilot: `CardPaymentsDisabledProvider` answers every charge with `provider_error` / `card_payments_disabled`, so `POST /rides/:id/settle` on a card ride is a 502 and the ride stays `completed`. The payment method locks at acceptance, so it cannot be re-settled as cash. **Do not offer card at booking while the pilot is cash-only** — that is the rider app's and the console's to enforce (payments barrel, KNOWN GAPS). | the SIA + a Stripe key |
| SMS reaches verified numbers only | Twilio trial | #137 |
| Direct-to-IP requests bypass Cloudflare | §2.3 | before the pilot opens |
| No uptime monitoring, no alerting | Uptime Kuma / GlitchTip are the intended €0 answers (architecture amendment) and are not installed here | when someone other than Linards needs to know it is down |

## 10 · Resize, snapshot, destroy

Hetzner bills hourly with no commitment. Resize in place to CX33 (4 vCPU /
8 GB, €8.49 `observed` 2026-08-14) from the console when metrics say so —
adding OSRM (#134) is `expected` to cost ~750 MB RSS, which still fits CX22.
To stop paying between testing sessions: take a snapshot (€0.0143/GB/mo
`observed` 2026-08-14), destroy the server, recreate from the snapshot later —
the volume comes back with it, but take a §6.1 backup first anyway. A demo day
costs roughly €0.30 (`derived`, research §3 note 4).
