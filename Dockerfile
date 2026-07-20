# syntax=docker/dockerfile:1
#
# T-503 — single-container deployment (docs/02-architecture.md §9, docs/07 D-024/D-031).
# One small runtime image: Fastify serves the built client (static + SPA fallback) and the ws
# hub on one port. Fully offline at runtime — no CDN/external assets (fonts are self-hosted,
# docs/11). Non-root runtime user, /health HEALTHCHECK, NODE_ENV=production.
#
# Build:  docker build -t hexhaven-web .
# Run:    docker run -p 8080:8080 -e LOBBY_PASSWORD=changeme hexhaven-web
# (docs/09-runbook.md has the full LAN/VPS walkthrough; compose.yaml wraps this for local use.)

# RK-9: exact versions pinned, never a floating "latest"/"lts" tag. Bump only via PM-reviewed edit.
ARG NODE_VERSION=22.13.0
ARG PNPM_VERSION=11.11.0

# ---------------------------------------------------------------------------------------------
# Stage 1 — builder: full workspace install + build (shared -> engine -> server via tsc -b
# project references; client via vite build). Needs devDependencies + all source.
# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS builder
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app

# Manifests first for layer caching — dependency install only re-runs when a package.json or
# the lockfile changes, not on every source edit.
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY apps/server/package.json apps/server/package.json
COPY apps/client/package.json apps/client/package.json
RUN pnpm install --frozen-lockfile

# Now the source and the root TS project-reference config, then build every workspace.
COPY tsconfig.json tsconfig.base.json ./
COPY packages ./packages
COPY apps ./apps
RUN pnpm -w build

# Offline check (T-503 §5): the built client must make zero external requests at runtime — scan
# the built client bundle for http(s):// literals. Allowlist is intentionally tiny and named:
#   - w3.org           — the SVG XML namespace URI (inert markup, never fetched)
#   - reactjs.org       — React's minified-error "invariant" decoder link (human-readable text
#                         inside a thrown Error's message, shown only in a dev console; not a URL
#                         the app ever requests)
#   - github.com/pmndrs — zustand's deprecation-warning console message linking to its GitHub
#                         discussion; same as above, a string literal never fetched
# Anything else fails the build. (See T-503 Implementation notes for how this was verified against
# the actual production bundle, and the deviation from the task's literal "allowlist: none".)
RUN grep -RInoE "https?://[^\"'\`) ]+" apps/client/dist \
      | grep -Ev "w3\.org|reactjs\.org|github\.com/pmndrs" \
      | { ! grep .; } \
    || (echo "Offline check FAILED: external URL literal(s) found in the client build (see above)" && exit 1)

# ---------------------------------------------------------------------------------------------
# Stage 2 — prod-deps: a second, clean install scoped to *only* @hexhaven/server's production
# dependency graph (fastify, ws, pino, nanoid, @fastify/static, zod via @hexhaven/shared). Skips
# every devDependency and the client's entire react/vite/tailwind tree, which the runtime image
# never needs (the client ships as pre-built static files, not a running process).
# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS prod-deps
ARG PNPM_VERSION
RUN corepack enable && corepack prepare pnpm@${PNPM_VERSION} --activate
WORKDIR /app
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/engine/package.json packages/engine/package.json
COPY apps/server/package.json apps/server/package.json
RUN pnpm install --prod --frozen-lockfile --filter @hexhaven/server...

# ---------------------------------------------------------------------------------------------
# Stage 3 — runtime: node:slim + pruned node_modules + built dist only. No pnpm, no source,
# no devDependencies. Target < 300 MB (T-503 §6).
# ---------------------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-slim AS runtime
ENV NODE_ENV=production
ENV PORT=8080
WORKDIR /app

# node:*-slim ships a preexisting non-root "node" user/group (uid/gid 1000) — reuse it rather
# than creating a new one.
COPY --chown=node:node --from=prod-deps /app ./
COPY --chown=node:node --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --chown=node:node --from=builder /app/packages/engine/dist ./packages/engine/dist
COPY --chown=node:node --from=builder /app/apps/server/dist ./apps/server/dist
COPY --chown=node:node --from=builder /app/apps/client/dist ./apps/client/dist

USER node

EXPOSE 8080

# Plain Node one-liner (no curl/wget in *-slim) using the global fetch built into Node 22.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "apps/server/dist/index.js"]
