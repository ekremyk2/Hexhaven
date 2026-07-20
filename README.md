# Hexhaven

A web board game of trade and settlement for **3–6 players**, self-hosted on a private server.
Compete to grow settlements and cities across a hex island, trade resources, and race to the
victory-point target. Bilingual (English + Turkish), with an original visual design system and a
strong built-in AI so you can fill any seat with a bot.

Hexhaven ships the core game plus four optional, self-contained expansions the host toggles per
game — each config-gated and independently balanced:

| Expansion | Adds |
|---|---|
| **Open Seas** | Sea maps, ships, exploration, and island scenarios (incl. 5–6-player boards). |
| **Walls & Watchmen** | Commodities, city improvements & metropolises, knights, and barbarian sieges. |
| **Roads & Raiders** | Fishermen, rivers, caravans, a barbarian scenario, and the combined campaign (3–4 & 5–6). |
| **Sails & Scoundrels** | Ship voyages, fog exploration, harbor settlements, and fish/spice/pirate-lair missions (3–4 & 5–6). |

Plus a composable **Modifiers** menu (house-rule toggles, custom tunable constants, cosmetic
themes, extra hex pieces, card variants) that stacks on top of any base game.

## Status

**Playable and complete** — base game, the 5–6-player extension, all four expansions, and the
modifier system are implemented, simulation-verified, and pass a full automated test suite.

## Tech stack

TypeScript monorepo (pnpm workspaces):

- `packages/shared` — protocol schemas, shared types & constants (zod).
- `packages/engine` — a pure, deterministic rules engine (seeded RNG, no I/O) + the AI bot and a
  simulation/invariant suite.
- `apps/server` — Fastify + WebSocket game server with authoritative state and per-player redaction.
- `apps/client` — React + Vite + Zustand + Tailwind, SVG board rendering, i18n (en/tr).

## Getting started

Prerequisites: **Node 20+** and **pnpm 9+**.

```bash
pnpm install

# Dev: hot-seat client on Vite
pnpm --filter @hexhaven/client dev        # http://localhost:5173/hotseat

# Full build (all packages + client bundle)
pnpm -w build

# Run the production server (single port: serves the client + WebSocket API)
NODE_ENV=production node apps/server/dist/index.js   # http://localhost:8080
```

On Windows PowerShell, set the env var first:
`$env:NODE_ENV = 'production'; node apps/server/dist/index.js`

### Verify

```bash
pnpm -w typecheck
pnpm -w test        # full engine + client suite
pnpm -w lint
```

## Repository layout

| Path | Purpose |
|---|---|
| `packages/` | `shared`, `engine` (rules + AI + simulation) |
| `apps/` | `server` (Fastify + ws), `client` (React / Vite) |
| `e2e/` | Playwright end-to-end tests |

## Notes

- Games are held in memory; restarting the server ends any in-progress games.
- Hexhaven is an independent, original implementation and is not affiliated with or endorsed by any
  other board-game publisher.
