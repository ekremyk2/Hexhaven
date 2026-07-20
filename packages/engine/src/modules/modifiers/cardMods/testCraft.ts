// Test-only state builder shared by newCards.test.ts/comboCards.test.ts — NOT a `*.test.ts` file
// itself (vitest never collects it as a suite). Mirrors `phases/devCards.test.ts`'s own local
// `craft()` exactly (a real generated board via `createGame`, GEOMETRY vertex/edge ids picked the
// same way, every other field pinned explicitly) so these tests read the same way the base
// dev-card tests they sit beside do.

import { GEOMETRY } from '@hexhaven/shared';
import type { DevCardType, EdgeId, GameState, HexId, ResourceType, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from '../../../createGame.js';

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 10,
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: false as const },
};

export interface Place {
  seat: Seat;
  settlements?: number[];
  cities?: number[];
  roads?: number[];
  hand?: Partial<Record<ResourceType, number>>;
  devCards?: { type: DevCardType; boughtOnTurn: number }[];
  playedKnights?: number;
  piecesLeft?: { roads: number; settlements: number; cities: number };
}

export interface Craft {
  place?: Place[];
  bank?: Partial<Record<ResourceType, number>>;
  devDeck?: DevCardType[];
  phase?: GameState['phase'];
  turnNumber?: number;
  turnPlayer?: Seat;
  rolled?: boolean;
  roll?: [number, number] | null;
  devPlayed?: boolean;
  robber?: number;
  rng?: number;
}

export function craft(opts: Craft = {}): GameState {
  const g = createGame({ ...CONFIG, seed: 'cardmods' });
  const players = g.players.map((p) => {
    const pl = (opts.place ?? []).find((x) => x.seat === p.seat);
    if (!pl) return p;
    const settlements = (pl.settlements ?? []).map((n) => n as VertexId);
    const cities = (pl.cities ?? []).map((n) => n as VertexId);
    const roads = (pl.roads ?? []).map((n) => n as EdgeId);
    return {
      ...p,
      settlements,
      cities,
      roads,
      resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0, ...pl.hand },
      devCards: pl.devCards ?? [],
      playedKnights: pl.playedKnights ?? 0,
      piecesLeft: pl.piecesLeft ?? {
        roads: 15 - roads.length,
        settlements: 5 - settlements.length,
        cities: 4 - cities.length,
      },
    };
  });
  return {
    ...g,
    players,
    bank: { ...g.bank, ...opts.bank },
    devDeck: opts.devDeck ?? g.devDeck,
    board: { ...g.board, robber: (opts.robber ?? g.board.robber) as HexId },
    rng: opts.rng ?? g.rng,
    turn: {
      number: opts.turnNumber ?? 5,
      player: opts.turnPlayer ?? 0,
      rolled: opts.rolled ?? true,
      roll: opts.roll === undefined ? [3, 4] : opts.roll,
      devPlayed: opts.devPlayed ?? false,
    },
    phase: opts.phase ?? { kind: 'main' },
    trade: null,
  };
}

export const h = (id: number) => GEOMETRY.hexes[id]!;
export const vtx = (hexId: number, k: number) => h(hexId).vertices[k]! as number;
