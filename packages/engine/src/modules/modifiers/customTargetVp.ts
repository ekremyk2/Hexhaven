// customTargetVp modifier (T-901 proof #1: a constant-OVERRIDE modifier, docs/07 D-034).
// Overrides `targetVp` (R13.2's win threshold) with the host's chosen number, via the same
// `ModuleConstants.targetVp` seam an expansion uses (Cities & Knights' 13-VP target, modules/
// citiesKnights/index.ts). `resolveConstants` (modules/index.ts) folds every active module's
// `constants` in `modules` order, and this modifier is always appended LAST (after every
// expansion, registry.ts) — so it wins over a C&K game's own target too, exactly the behavior
// docs/tasks/phase-9/PICKS.md calls for ("allow it, it just changes the win threshold").

import type { RuleModule } from '../types.js';

export function customTargetVpModule(targetVp: number): RuleModule {
  return { id: 'customTargetVp', constants: { targetVp } };
}
