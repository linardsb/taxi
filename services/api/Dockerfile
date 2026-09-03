# syntax=docker/dockerfile:1
# Runtime image for @taxi/api (#13). Build from the REPO ROOT — the context is
# the whole workspace, filtered by the root .dockerignore:
#
#   docker build -f services/api/Dockerfile -t taxi-api .
#
# What the image runs (all from WORKDIR /app):
#   node dist/main.js                                the API (CMD)
#   node node_modules/@taxi/db/dist/migrate-run.js   migrations — every deploy, before the API
#   node node_modules/@taxi/db/dist/seed/run.js      the Rīga seed — ONCE, by hand (runbook)
#
# Three stages. `deps` installs the full dependency graph of @taxi/api from
# manifests alone (layer-cached across source edits); `build` compiles
# shared → db → api on top of it, then `pnpm deploy` writes the runtime tree
# to /app/deploy: the api's own files plus its PRODUCTION dependencies only,
# with the two workspace packages (`@taxi/shared`, `@taxi/db`) copied in as
# real directories under node_modules, dist and migrations included. The
# runtime stage copies that one directory and nothing else.
#
# NOT a second `pnpm install --prod --filter @taxi/api...`, which was the
# first cut: under the root .npmrc's `node-linker=hoisted` a filtered install
# still resolves the WHOLE lockfile, so that runtime carried @expo, next,
# react-native, jest and typescript — 1,547 MB of node_modules in a 2.38 GB
# image (`observed` 2026-09-03 on `dff4c4f`, PR #147 review round 1, F2).
# With `deploy`, `docker run --rm taxi-api du -sm node_modules` → 81 MB,
# `docker image ls` → 388 MB, `docker save | gzip -1` → 79,824,202 bytes
# (`observed` 2026-09-03 on the image built from this file at the round-1 fix
# commit; none of those eight packages present). None of the three workspace
# packages has a `files` field, so each one's `src` rides along — /app is
# 86 MB against the 81 MB of node_modules, not worth a manifest edit.
# Re-measure with those commands after any change here.
#
# Not run here, on purpose: `test` — both `pretest` scripts shell out to
# `docker compose`, which does not exist inside a build.

FROM node:20-bookworm-slim AS base
# Pinned to the root package.json's `packageManager`. npm rather than corepack:
# corepack's bundled signing keys have lagged pnpm's rotation before, and a
# build that fails on a key is not a build.
RUN npm install -g pnpm@10.33.2
ENV PNPM_STORE=/pnpm/store
RUN pnpm config set store-dir $PNPM_STORE
WORKDIR /app

FROM base AS manifests
# EVERY workspace package.json, apps included: --frozen-lockfile checks the
# lockfile against every importer it lists, not only the filtered ones, and a
# missing importer reads as "lockfile out of date".
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc package.json ./
COPY apps/rider/package.json apps/rider/
COPY apps/driver/package.json apps/driver/
COPY apps/dispatch/package.json apps/dispatch/
COPY packages/config/package.json packages/config/
COPY packages/shared/package.json packages/shared/
COPY db/package.json db/
COPY services/api/package.json services/api/

FROM manifests AS deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @taxi/api...

FROM deps AS build
COPY packages/config packages/config
COPY packages/shared packages/shared
COPY db db
COPY services/api services/api
# pnpm orders workspace scripts topologically, so this is shared → db → api.
# Not `turbo`: it is a root devDependency the filtered install leaves out.
RUN pnpm --filter @taxi/api... run build
# `--legacy`: pnpm 10's default `deploy` wants `inject-workspace-packages=true`
# in .npmrc, which would change how the workspace links for every developer;
# the legacy implementation copies `@taxi/shared` and `@taxi/db` in as they
# are on disk after the build above. `db/dist/migrate.js` resolves the .sql
# files from `__dirname/../migrations`, which lands at
# node_modules/@taxi/db/migrations — validated by running the migrator and
# booting the image, not by reading this line.
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @taxi/api deploy --prod --legacy --frozen-lockfile /app/deploy

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/deploy ./
USER node
EXPOSE 3001
CMD ["node", "dist/main.js"]
