// Test factory (docs/05 §4): `stateWith(overrides)` deep-merges over a LEGAL mid-game base
// state so engine tests never hand-craft deep state literals. Shipped via the
// `@hexhaven/engine/testkit` subpath — never from the package index, so app code cannot pull it in.

import { GEOMETRY, TARGET_VP } from '@hexhaven/shared';
import type { EdgeId, GameConfig, GameState, ResourceType, Seat, VertexId } from '@hexhaven/shared';
import { createGame } from './createGame.js';

const TESTKIT_CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: TARGET_VP,
  seed: 'testkit',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

/** Setup snake order for 8 placements across 4 seats (R3.1). */
const SNAKE: readonly Seat[] = [0, 1, 2, 3, 3, 2, 1, 0];

/** Every player's fixed post-setup hand (3 cards); the bank is rebalanced to keep I1 true. */
const BASE_HAND: Record<ResourceType, number> = { brick: 1, lumber: 1, wool: 1, grain: 0, ore: 0 };

/**
 * Deterministically pick 8 vertices that satisfy the distance rule (R7.3): walk vertices in id
 * order, greedily keeping any vertex not adjacent to one already kept.
 */
function pickSetupVertices(): VertexId[] {
  const picked: VertexId[] = [];
  for (const vertex of GEOMETRY.vertices) {
    if (picked.length === 8) break;
    if (!picked.some((p) => vertex.neighbors.includes(p))) picked.push(vertex.id);
  }
  if (picked.length !== 8) throw new Error('BUG: testkit board cannot seat 8 settlements');
  return picked;
}

/**
 * The legal mid-game base: seed "testkit", 4 players, each holding 2 settlements + 2 attached
 * roads (snake-drafted, distance-rule-clean) and 3 resource cards (bank rebalanced), player 0
 * in `main` having rolled. Invariants I1/I2 hold; awards are unclaimed (no chain ≥ 5 roads, no
 * knights played), matching I6.
 */
function buildBaseState(): GameState {
  const created = createGame(TESTKIT_CONFIG);

  const settlementsBySeat = new Map<Seat, VertexId[]>();
  const roadsBySeat = new Map<Seat, EdgeId[]>();
  pickSetupVertices().forEach((vertexId, i) => {
    const seat = SNAKE[i];
    if (seat === undefined) throw new Error('BUG: snake order exhausted');
    const vertex = GEOMETRY.vertices[vertexId];
    if (!vertex) throw new Error(`BUG: unknown vertex ${vertexId}`);
    const edge = vertex.edges[0]; // R3.3: the road attaches to the settlement just placed.
    if (edge === undefined) throw new Error(`BUG: vertex ${vertexId} has no edges`);
    settlementsBySeat.set(seat, [...(settlementsBySeat.get(seat) ?? []), vertexId]);
    roadsBySeat.set(seat, [...(roadsBySeat.get(seat) ?? []), edge]);
  });

  const players = created.players.map((p) => {
    const settlements = settlementsBySeat.get(p.seat);
    const roads = roadsBySeat.get(p.seat);
    if (!settlements || !roads) throw new Error(`BUG: no setup pieces for seat ${p.seat}`);
    return {
      ...p,
      resources: { ...BASE_HAND },
      settlements,
      roads,
      piecesLeft: {
        roads: p.piecesLeft.roads - roads.length,
        settlements: p.piecesLeft.settlements - settlements.length,
        cities: p.piecesLeft.cities,
      },
    };
  });

  const handedOutPerType = 4; // 4 players × 1 card of each handed-out type
  const bank = {
    ...created.bank,
    brick: created.bank.brick - handedOutPerType,
    lumber: created.bank.lumber - handedOutPerType,
    wool: created.bank.wool - handedOutPerType,
  };

  return {
    ...created,
    players,
    bank,
    turn: { number: 5, player: 0, rolled: true, roll: [4, 2], devPlayed: false },
    phase: { kind: 'main' },
    stateVersion: 25,
  };
}

/**
 * Deep-partial of T: plain objects become recursively optional; arrays/tuples stay whole
 * (overriding an array always replaces it, never merges elements).
 */
export type DeepPartial<T> = T extends readonly unknown[]
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function deepMerge(base: unknown, override: unknown): unknown {
  if (!isPlainObject(base) || !isPlainObject(override)) return override;
  // Discriminated-union safety: a `kind`-tagged override of a DIFFERENT kind replaces
  // wholesale — merging `{kind:'ended'}` into `{kind:'main'}` must not produce a chimera.
  if ('kind' in base && 'kind' in override && base['kind'] !== override['kind']) return override;
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value === undefined) continue; // `undefined` never overrides — use null where typed
    out[key] = key in base ? deepMerge(base[key], value) : value;
  }
  return out;
}

/**
 * The factory all engine tests use (docs/05 §4). Merge semantics: plain objects merge per key;
 * arrays, tuples and null replace wholesale; a `kind`-tagged object of a different kind replaces
 * wholesale (supply FULL phase objects when switching phase kind — DeepPartial cannot enforce
 * the missing fields).
 */
export function stateWith(overrides: DeepPartial<GameState> = {}): GameState {
  return deepMerge(buildBaseState(), overrides) as GameState;
}

/** Recursive Object.freeze — used to prove the dispatcher never mutates its input state. */
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
    Object.freeze(value);
  }
  return value;
}
