// playDevSameTurn modifier (T-906 wave A-1, docs/07 D-034 / docs/tasks/phase-9/PICKS.md "play dev
// card same turn"). House rule: waives R9.4's "a development card can't be played the same turn it
// was bought" restriction.
//
// Same constant-OVERRIDE archetype as `customTargetVp` (modules/modifiers/customTargetVp.ts):
// `ModuleConstants.allowDevCardSameTurnPlay` folds in via `resolveConstants` (modules/index.ts),
// and `phases/devCards.ts`'s `commonPlayBlockReason`/`beginPlay` — the ONE place R9.4 is enforced,
// shared by all four "play" actions — read it back via `devCardIsPlayable`, a tiny, minimal hook
// documented at that call site. This is the "tiny base hook" the task brief allows when no cleaner
// seam exists: `interceptAction` can't do this cleanly, because the four play actions
// (`playKnight`/`playRoadBuilding`/`playYearOfPlenty`/`playMonopoly`) are routed to FOUR separate
// functions from TWO different phase handlers (`phases/roll.ts`'s preRoll switch, `phases/main.ts`'s
// main switch) that would each need reimplementing to bypass the shared guard — reading a resolved
// constant is far less invasive than duplicating four handlers, and keeps a single source of truth
// for the R9.4 gate.
//
// No matrix entry needed: a Cities & Knights game rejects every base dev-card action
// (`buyDevCard`/`playKnight`/`playRoadBuilding`/`playYearOfPlenty`/`playMonopoly`) outright with
// `DEV_CARDS_DISABLED` via C&K's own `interceptAction`, BEFORE routing ever reaches
// `phases/devCards.ts` (C11.1) — so this modifier's constant is simply never consulted in a C&K
// game, the same "no-op while locked/disabled" composition `friendlyRobber.ts` documents for C&K's
// robber-lock.

import type { RuleModule } from '../types.js';

export const playDevSameTurnModule: RuleModule = {
  id: 'playDevSameTurn',
  constants: { allowDevCardSameTurnPlay: true },
};
