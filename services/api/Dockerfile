# syntax=docker/dockerfile:1
# Runtime image for @taxi/api (#13). Build from the REPO ROOT — the context is
# the whole workspace, filtered by the root .dockerignore:
#
#   docker build -f services/api/Dockerfile -t taxi-api .
#
# What the image runs (all from WORKDIR /app):
#   node services/api/dist/main.js      the API (CMD)
#   node db/dist/migrate-run.js         migrations — every deploy, before the API
#   node db/dist/seed/run.js            the Rīga seed — ONCE, by hand (runbook)
#
# Three stages. `deps` installs the full dependency graph of @taxi/api from
# manifests alone (layer-cached across source edits); `build` compiles
# shared → db → api on top of it; `prod-deps` is a second, --prod install so
# the runtime carries no compiler, no drizzle-kit, no jest. The root .npmrc's
# `node-linker=hoisted` puts every third-party package flat under the root
# node_modules — and the WORKSPACE links (`@taxi/shared`, `@taxi/db`) under
# each consumer's own node_modules as relative symlinks, so the runtime copies
# those two small folders as well. Verified by booting the image, not by
# reading pnpm docs: the first cut copied only the root and died on
# `Cannot find module '@taxi/shared'` from db/dist.
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

FROM manifests AS prod-deps
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --filter @taxi/api... --prod

FROM node:20-bookworm-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
# Each workspace package keeps its package.json (main → dist) beside its dist,
# at the SAME relative paths as the source tree, because the per-package
# node_modules/@taxi/* entries are relative symlinks (../../../packages/shared).
COPY --from=prod-deps /app/packages/shared/package.json packages/shared/
COPY --from=build     /app/packages/shared/dist          packages/shared/dist
COPY --from=prod-deps /app/db/package.json               db/
COPY --from=prod-deps /app/db/node_modules               db/node_modules
COPY --from=build     /app/db/dist                       db/dist
# `db/dist/migrate.js` resolves MIGRATIONS_DIR to `__dirname/../migrations`,
# so the .sql files and meta/_journal.json must sit exactly here. Validated by
# running the migrator inside the image, not by reading this line.
COPY --from=build     /app/db/migrations                 db/migrations
COPY --from=prod-deps /app/services/api/package.json     services/api/
COPY --from=prod-deps /app/services/api/node_modules     services/api/node_modules
COPY --from=build     /app/services/api/dist             services/api/dist
USER node
EXPOSE 3001
CMD ["node", "services/api/dist/main.js"]
