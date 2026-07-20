// hiddenSetupNumbers modifier (blind-placement house rule): the hex number tokens stay hidden for
// every player through the whole initial settlement/road setup, then are revealed the moment setup
// completes (the phase leaves `setup`). The effect is REDACTION-ONLY — the engine state always
// holds the real numbers; `redact()` (redact.ts) strips `board.hexes[*].token` and flags the view
// with `hiddenNumbers: true` while `state.phase.kind === 'setup'` and this modifier is enabled. So
// this RuleModule carries no hooks: its presence in `config.modifiers` is the only signal `redact`
// needs. Hook-less by design means it can never alter engine behavior — only what clients see.
import type { RuleModule } from '../types.js';

export const hiddenSetupNumbersModule: RuleModule = { id: 'hiddenSetupNumbers' };
