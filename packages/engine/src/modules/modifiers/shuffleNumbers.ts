// shuffleNumbers modifier (board-setup house rule): randomize the number-token positions while
// preserving the exact multiset of numbers. The whole effect lives in `createGame` — when this
// modifier is enabled it routes board generation through the existing R2.5 "shuffled" token method
// (boardGen.ts's `assignTokensShuffled`), which draws a fresh count-preserving permutation from the
// seeded rng and redraws until no two 6/8 hexes are adjacent. So this RuleModule itself carries no
// hooks: its presence in `config.modifiers` is the only signal `createGame` needs, exactly like the
// board never being touched by a modifier before (registry.ts). Keeping it hook-less means it can
// never affect any turn-time code path — only the initial layout.
import type { RuleModule } from '../types.js';

export const shuffleNumbersModule: RuleModule = { id: 'shuffleNumbers' };
