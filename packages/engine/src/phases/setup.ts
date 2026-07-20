// Setup phase (R3): the snake-draft of 2 settlements + 2 roads per player, starting resources
// from the second settlement, and the handoff to normal play. Registered as the `setup` handler
// in reduce.ts. Type-only imports from reduce.js keep the emitted JS free of an import cycle.

import { TERRAIN_RESOURCE } from '@hexhaven/shared';
import type {
  EngineErrorCode,
  GameEvent,
  GameState,
  PlayerState,
  ResourceBundle,
  Seat,
} from '@hexhaven/shared';
import type { EngineResult, PhaseHandler } from '../reduce.js';
import { setupPlaced, startingResources } from '../events.js';
import { geometryForState } from '../modules/index.js';
import { isEdgeOccupied, isVertexOccupied } from '../rules/placement.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

/** Total settlements placed so far == the index of the next settlement in the draft (R3.1). */
function settlementsPlaced(state: GameState): number {
  return state.players.reduce((sum, p) => sum + p.settlements.length, 0);
}

/**
 * The seat that places the settlement at draft `index` (0-based) for `n` players (R3.1):
 * round 1 ascending 0…n−1, round 2 descending n−1…0.
 */
function snakeSeat(index: number, n: number): Seat {
  return (index < n ? index : 2 * n - 1 - index) as Seat;
}

export const setupHandler: PhaseHandler = (state, seat, action): EngineResult => {
  if (state.phase.kind !== 'setup') return fail('WRONG_PHASE', 'not in the setup phase');
  const phase = state.phase;
  const n = state.config.playerCount;

  if (action.type === 'placeSetupSettlement') {
    if (phase.expect !== 'settlement') {
      return fail('WRONG_PHASE', 'a road is owed before the next settlement');
    }
    const v = action.vertex;
    const vert = geometryForState(state).vertices[v];
    if (!vert) return fail('BAD_LOCATION', `vertex ${v} is off the board`);
    if (isVertexOccupied(state, v)) return fail('OCCUPIED', `vertex ${v} already has a building`);
    if (vert.neighbors.some((nb) => isVertexOccupied(state, nb))) {
      return fail('DISTANCE_RULE', `vertex ${v} is adjacent to a building (R7.3)`);
    }

    const index = settlementsPlaced(state); // this settlement's draft index
    const round: 1 | 2 = index < n ? 1 : 2;

    // R3.4: the second (round-2) settlement grants one resource per adjacent non-desert hex.
    const gained: ResourceBundle = {};
    const bank = { ...state.bank };
    if (round === 2) {
      for (const hexId of vert.hexes) {
        const tile = state.board.hexes[hexId];
        if (!tile) continue;
        const res = TERRAIN_RESOURCE[tile.terrain];
        if (res == null) continue;
        // Never overdraw the bank into the negative (R5.4 "can't give what isn't there"). In a base
        // game the bank (19/24) always dwarfs setup grants, so this is a no-op and RK-13 stays
        // bit-identical; it only bites when `customConstants.startingResources` has already debited a
        // resource near-empty at createGame — without this guard the shared bank went negative during
        // the second-settlement allocation (user-reported).
        if (bank[res] <= 0) continue;
        gained[res] = (gained[res] ?? 0) + 1;
        bank[res] -= 1;
      }
    }

    const players: PlayerState[] = state.players.map((p) => {
      if (p.seat !== seat) return p;
      const resources = { ...p.resources };
      for (const res of Object.keys(gained) as (keyof ResourceBundle)[]) {
        resources[res] += gained[res] ?? 0;
      }
      return {
        ...p,
        resources,
        settlements: [...p.settlements, v],
        piecesLeft: { ...p.piecesLeft, settlements: p.piecesLeft.settlements - 1 },
      };
    });

    const events: GameEvent[] = [setupPlaced(seat, 'settlement', v)];
    if (round === 2) events.push(startingResources(seat, gained));

    return {
      ok: true,
      state: {
        ...state,
        players,
        bank,
        phase: { kind: 'setup', round, expect: 'road', lastSettlement: v },
      },
      events,
    };
  }

  if (action.type === 'placeSetupRoad') {
    if (phase.expect !== 'road') return fail('WRONG_PHASE', 'a settlement is owed before the road');
    const e = action.edge;
    const edge = geometryForState(state).edges[e];
    if (!edge) return fail('BAD_LOCATION', `edge ${e} is off the board`);
    if (isEdgeOccupied(state, e)) return fail('OCCUPIED', `edge ${e} already has a road`);
    const last = phase.lastSettlement;
    if (last == null) throw new Error('BUG: setup road with no lastSettlement');
    if (edge.a !== last && edge.b !== last) {
      return fail('NOT_CONNECTED', 'the road must attach to the settlement just placed (R3.3)');
    }

    const players: PlayerState[] = state.players.map((p) =>
      p.seat === seat
        ? {
            ...p,
            roads: [...p.roads, e],
            piecesLeft: { ...p.piecesLeft, roads: p.piecesLeft.roads - 1 },
          }
        : p
    );

    // Settlement count is unchanged by a road; it equals the number of settlements placed.
    const placed = settlementsPlaced(state);
    const events: GameEvent[] = [setupPlaced(seat, 'road', e)];

    if (placed === 2 * n) {
      // R3.5: draft complete — player 0 opens turn 1 in preRoll.
      return {
        ok: true,
        state: {
          ...state,
          players,
          phase: { kind: 'preRoll' },
          turn: { number: 1, player: 0, rolled: false, roll: null, devPlayed: false },
        },
        events,
      };
    }

    const drafter = snakeSeat(placed, n);
    const round: 1 | 2 = placed < n ? 1 : 2;
    return {
      ok: true,
      state: {
        ...state,
        players,
        phase: { kind: 'setup', round, expect: 'settlement', lastSettlement: null },
        turn: { ...state.turn, player: drafter },
      },
      events,
    };
  }

  return fail('WRONG_PHASE', `action ${action.type} is not legal during setup`);
};
