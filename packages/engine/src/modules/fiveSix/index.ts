// The 5–6 Player Extension as a RuleModule (docs/10 §4, docs/rules/fivesix-rules.md).
//
// T-601 shipped the data-only foundation: the 30-hex board, its generation multisets, and the
// bumped bank / dev deck / seat colors. T-602 adds the one new *rule* — the extra-building
// opportunity — as BOTH official editions, selectable via `config.variants.fiveSixTurnRule`:
//   • 'sbp'           → 2015 Special Building Phase (default), a dedicated `specialBuild` phase.
//   • 'pairedPlayers' → 2022 Paired Players, a restricted partial turn for "player 2".
// Both are wired here as module hooks (phaseHandlers / phaseHooks / interceptAction / isActorAllowed
// / winCheckSeat), consulted generically by `reduce` — the base engine never names either rule, so
// with fiveSix off every hook path is skipped and base behavior stays bit-identical (RK-13).

import {
  EXT56_BANK_PER_RESOURCE,
  EXT56_DEV_DECK,
  EXT56_HARBOR_MIX,
  EXT56_LAYOUT,
  EXT56_TERRAIN_COUNTS,
  EXT56_TOKEN_SPIRAL,
  GEOMETRY_EXT56,
  PIECES_PER_PLAYER,
} from '@hexhaven/shared';
import type { PlayerColor } from '@hexhaven/shared';
import type { RuleModule } from '../types.js';
import { fiveSixTurnRule } from './common.js';
import { pairedAfterTurnEnd, pairedInterceptAction } from './pairedPlayers.js';
import { specialBuildAfterTurnEnd, specialBuildHandler } from './specialBuild.js';

/** X8: seats 4→green, 5→brown (base red/blue/white/orange unchanged). */
const EXT56_SEAT_COLORS: readonly PlayerColor[] = [
  'red',
  'blue',
  'white',
  'orange',
  'green',
  'brown',
];

export const fiveSixModule: RuleModule = {
  id: 'fiveSix',
  boardLayout: EXT56_LAYOUT,
  boardGeometry: GEOMETRY_EXT56,
  boardParams: {
    terrainCounts: EXT56_TERRAIN_COUNTS,
    harborMix: EXT56_HARBOR_MIX,
    tokenSpiral: EXT56_TOKEN_SPIRAL,
  },
  constants: {
    bankPerResource: EXT56_BANK_PER_RESOURCE,
    devDeck: EXT56_DEV_DECK,
    // X9: pieces per player unchanged (15 roads / 5 settlements / 4 cities).
    piecesPerPlayer: PIECES_PER_PLAYER,
    seatColors: EXT56_SEAT_COLORS,
  },

  // ---- The X12 extra-build rule (T-602), dispatched by the selected turn rule -------------------

  phaseHandlers: { specialBuild: specialBuildHandler },

  phaseHooks: {
    afterTurnEnd(prev, advanced, events) {
      return fiveSixTurnRule(prev.config) === 'pairedPlayers'
        ? pairedAfterTurnEnd(prev, advanced, events)
        : specialBuildAfterTurnEnd(prev, advanced, events);
    },
  },

  // Only the Paired-Players partial turn (a repurposed `main` phase) needs pre-routing
  // interception; the SBP is a dedicated phase whose own handler enforces its matrix.
  interceptAction(state, seat, action) {
    return pairedInterceptAction(state, seat, action);
  },

  // SBP: the current builder acts although `turn.player` is still the seat whose turn just ended.
  // (Paired Players makes player 2 the `turn.player`, so it needs no actor-guard extension.)
  isActorAllowed(state, seat) {
    return state.phase.kind === 'specialBuild' && seat === state.phase.builder;
  },

  // SBP: nobody wins mid-phase; a ≥10-VP builder wins only when play reaches their own next turn —
  // the transition OUT of the SBP re-checks the incoming owner (base start-of-turn semantics). Every
  // other case (incl. the Paired-Players partial turn, where turn.player === builder) uses the base
  // rule, so player 2 can win and player 1's earlier-resolved full turn wins any same-round tie.
  winCheckSeat(prev, next, _actingSeat, baseWinSeat) {
    if (next.phase.kind === 'specialBuild') return null;
    if (prev.phase.kind === 'specialBuild') return next.turn.player;
    return baseWinSeat;
  },
};
