// Unit tests for the 9 actively-triggered helper handlers (T-905). Each helper gets a happy path
// plus at least one guard/error path. States are crafted directly via `createGame` + full player
// overrides (mirrors friendlyRobber.test.ts's `craft()` pattern) so board geometry/connectivity is
// real, never through `resolveModules`/`reduce` (the modifier isn't wired into those yet).

import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type {
  DevCardType,
  EdgeId,
  GameConfig,
  GameState,
  HexId,
  ResourceType,
  Seat,
  VertexId,
} from '@hexhaven/shared';
import { createGame } from '../../../createGame.js';
import {
  captainBankTrade,
  useArchitect,
  useArchitectBeginPeek,
  useCaptain,
  useExplorer,
  useMayor,
  useMendicant,
  useMerchant,
  useNoblewoman,
  usePriest,
  useRobberBride,
} from './actions.js';
import { ensureHelpersExt, helpersExt } from './state.js';
import type { HelperId } from './types.js';

const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'helpers-actions-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

interface PlaceOpts {
  seat: Seat;
  settlements?: VertexId[];
  cities?: VertexId[];
  roads?: EdgeId[];
  hand?: Partial<Record<ResourceType, number>>;
  devCards?: { type: DevCardType; boughtOnTurn: number }[];
}

function craft(opts: { place?: PlaceOpts[]; robber?: HexId; hexes?: GameState['board']['hexes'] } = {}): GameState {
  const g = createGame(CONFIG);
  const players = g.players.map((p) => {
    const pl = (opts.place ?? []).find((x) => x.seat === p.seat);
    if (!pl) return p;
    return {
      ...p,
      settlements: pl.settlements ?? [],
      cities: pl.cities ?? [],
      roads: pl.roads ?? [],
      resources: { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0, ...pl.hand },
      devCards: pl.devCards ?? [],
    };
  });
  return {
    ...g,
    players,
    board: {
      ...g.board,
      hexes: opts.hexes ?? g.board.hexes,
      robber: opts.robber ?? g.board.robber,
    },
    turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
    phase: { kind: 'main' },
  };
}

/** Assigns `helper` to `seat`, side A, "acquired" on a past turn (-1) so the "same turn you
 *  received it" guard never blocks these handler-level tests. */
function withHelperAssigned(state: GameState, seat: Seat, helper: HelperId): GameState {
  const ensured = ensureHelpersExt(state);
  const ext = helpersExt(ensured)!;
  const bySeat = ext.bySeat.slice();
  bySeat[seat] = { id: helper, side: 'A', acquiredTurn: -1 };
  // `ext.helpers` isn't part of the real `GameState.ext` shape yet (PM WIRING — see the report);
  // `as GameState` is the deliberate cast boundary, same as state.ts's internal ext helpers.
  return { ...ensured, ext: { ...ensured.ext, helpers: { ...ext, bySeat } } } as GameState;
}

/** `.type` compared as a plain string — the local helper event `type` tags (`helperUsed`, ...)
 *  aren't in the real `GameEvent` union yet, so a direct literal comparison would fail TS's
 *  no-overlap check on the cast-through events. */
function typeOf(e: { type: string }): string {
  return e.type;
}

const v = (id: number) => GEOMETRY.vertices[id]!;
const e = (id: number) => GEOMETRY.edges[id]!;

describe('useMayor', () => {
  it('grants the chosen resource from the bank, flips A->B, clears eligibility', () => {
    let state = withHelperAssigned(craft(), 0, 'mayor');
    state = {
      ...state,
      ext: { ...state.ext, helpers: { ...helpersExt(state)!, mayorEligible: [true, false, false, false] } },
    } as GameState;
    const bankOreBefore = state.bank.ore;
    const result = useMayor(state, 0, 'ore');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.players.find((p) => p.seat === 0)!.resources.ore).toBe(1);
    expect(result.state.bank.ore).toBe(bankOreBefore - 1);
    expect(helpersExt(result.state)!.mayorEligible[0]).toBe(false);
    expect(helpersExt(result.state)!.bySeat[0]).toMatchObject({ side: 'B' });
    expect(result.events.some((ev) => typeOf(ev) === 'helperUsed')).toBe(true);
  });

  it('CANNOT_PLAY when not flagged eligible', () => {
    const state = withHelperAssigned(craft(), 0, 'mayor');
    const result = useMayor(state, 0, 'ore');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CANNOT_PLAY');
  });
});

describe('useExplorer', () => {
  it('relocates a terminal (dead-end) road to a legal empty edge', () => {
    const v0 = v(0);
    const from = v0.edges[0]!;
    const to = v0.edges[1]!;
    const state = withHelperAssigned(
      craft({ place: [{ seat: 0, settlements: [v0.id], roads: [from] }] }),
      0,
      'explorer'
    );
    const result = useExplorer(state, 0, from, to);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p0 = result.state.players.find((p) => p.seat === 0)!;
    expect(p0.roads).toEqual([to]);
    expect(helpersExt(result.state)!.bySeat[0]).toMatchObject({ side: 'B' });
  });

  it('BAD_LOCATION when the named road is not a dead end (anchored at both ends)', () => {
    const v0 = v(0);
    const from = e(v0.edges[0]!);
    const farVertex = from.a === v0.id ? from.b : from.a;
    const vFar = v(farVertex);
    const secondRoad = vFar.edges.find((ed) => ed !== v0.edges[0])!;
    const state = withHelperAssigned(
      craft({ place: [{ seat: 0, settlements: [v0.id], roads: [v0.edges[0]!, secondRoad] }] }),
      0,
      'explorer'
    );
    const result = useExplorer(state, 0, v0.edges[0]!, v0.edges[2]!);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('BAD_LOCATION');
  });
});

describe('useMendicant', () => {
  it('substitutes ore for the missing brick, paying lumber+ore instead of brick+lumber', () => {
    const v0 = v(0);
    const from = v0.edges[0]!;
    const to = v0.edges[1]!;
    const state = withHelperAssigned(
      craft({ place: [{ seat: 0, settlements: [v0.id], roads: [from], hand: { lumber: 1, ore: 1 } }] }),
      0,
      'mendicant'
    );
    const result = useMendicant(state, 0, to, 'brick', 'ore');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p0 = result.state.players.find((p) => p.seat === 0)!;
    expect(p0.roads).toContain(to);
    expect(p0.resources).toMatchObject({ lumber: 0, ore: 0, brick: 0 });
  });

  it('CANT_AFFORD when the substituted cost still cannot be paid', () => {
    const v0 = v(0);
    const from = v0.edges[0]!;
    const to = v0.edges[1]!;
    const state = withHelperAssigned(
      craft({ place: [{ seat: 0, settlements: [v0.id], roads: [from], hand: {} }] }),
      0,
      'mendicant'
    );
    const result = useMendicant(state, 0, to, 'brick', 'ore');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CANT_AFFORD');
  });
});

describe('useRobberBride', () => {
  function craftDesertBoard() {
    const g = createGame(CONFIG);
    const hexes = g.board.hexes.map((h, i) => (i === 0 ? { terrain: 'desert' as const, token: null } : h));
    return { g, hexes };
  }

  it('moves the robber to the desert and steals 1 from the vacated hex (single candidate)', () => {
    const { hexes } = craftDesertBoard();
    const targetHex = GEOMETRY.hexes[5]!;
    const settlementVertex = targetHex.vertices[0]!;
    const state = withHelperAssigned(
      craft({
        hexes,
        robber: 5 as HexId,
        place: [{ seat: 1, settlements: [settlementVertex], hand: { brick: 2 } }],
      }),
      0,
      'robberBride'
    );
    const result = useRobberBride(state, 0, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.board.robber).toBe(0);
    expect(result.events.some((ev) => typeOf(ev) === 'robberMoved')).toBe(true);
    expect(result.events.some((ev) => typeOf(ev) === 'stolen')).toBe(true);
    const p0 = result.state.players.find((p) => p.seat === 0)!;
    const p1 = result.state.players.find((p) => p.seat === 1)!;
    expect(p0.resources.brick + p1.resources.brick).toBe(2);
    expect(p1.resources.brick).toBe(1);
  });

  it('ROBBER_SAME_HEX when the robber is already on the desert', () => {
    const { hexes } = craftDesertBoard();
    const state = withHelperAssigned(craft({ hexes, robber: 0 as HexId }), 0, 'robberBride');
    const result = useRobberBride(state, 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ROBBER_SAME_HEX');
  });

  it('NOT_A_CANDIDATE when candidates exist but no target is named', () => {
    const { hexes } = craftDesertBoard();
    const targetHex = GEOMETRY.hexes[5]!;
    const state = withHelperAssigned(
      craft({
        hexes,
        robber: 5 as HexId,
        place: [{ seat: 1, settlements: [targetHex.vertices[0]!], hand: { brick: 1 } }],
      }),
      0,
      'robberBride'
    );
    const result = useRobberBride(state, 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_A_CANDIDATE');
  });
});

describe('useMerchant', () => {
  it('takes the demanded resource from each target that holds it, giving back the named card', () => {
    const state = withHelperAssigned(
      craft({
        place: [
          { seat: 0, hand: { ore: 1 } },
          { seat: 1, hand: { wool: 2 } },
          { seat: 2, hand: {} },
        ],
      }),
      0,
      'merchant'
    );
    const result = useMerchant(state, 0, [1, 2], 'wool', { 1: 'ore' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p0 = result.state.players.find((p) => p.seat === 0)!;
    const p1 = result.state.players.find((p) => p.seat === 1)!;
    const p2 = result.state.players.find((p) => p.seat === 2)!;
    expect(p0.resources.wool).toBe(1);
    expect(p0.resources.ore).toBe(0);
    expect(p1.resources.wool).toBe(1);
    expect(p1.resources.ore).toBe(1);
    expect(p2.resources.wool).toBe(0); // untouched — held none of the demanded resource
  });

  it('BAD_TRADE when a target holds the demanded resource but no give-back is named', () => {
    const state = withHelperAssigned(
      craft({ place: [{ seat: 0, hand: { ore: 1 } }, { seat: 1, hand: { wool: 1 } }] }),
      0,
      'merchant'
    );
    const result = useMerchant(state, 0, [1], 'wool', {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('BAD_TRADE');
  });

  it('CANT_AFFORD when the actor cannot pay the named give-back', () => {
    const state = withHelperAssigned(
      craft({ place: [{ seat: 0, hand: {} }, { seat: 1, hand: { wool: 1 } }] }),
      0,
      'merchant'
    );
    const result = useMerchant(state, 0, [1], 'wool', { 1: 'ore' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CANT_AFFORD');
  });
});

describe('useCaptain + captainBankTrade', () => {
  it('activates a 2:1 rate for the chosen resource this rotation', () => {
    const state = withHelperAssigned(craft(), 0, 'captain');
    const result = useCaptain(state, 0, 'ore');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(helpersExt(result.state)!.captainRate[0]).toBe('ore');
    expect(helpersExt(result.state)!.bySeat[0]).toMatchObject({ side: 'B' });
  });

  it('captainBankTrade trades exactly 2:1, regardless of harbors', () => {
    const state = craft({ place: [{ seat: 0, hand: { ore: 2 } }] });
    const bankWoolBefore = state.bank.wool;
    const bankOreBefore = state.bank.ore;
    const result = captainBankTrade(state, 0, 'ore', 'wool');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p0 = result.state.players.find((p) => p.seat === 0)!;
    expect(p0.resources.ore).toBe(0);
    expect(p0.resources.wool).toBe(1);
    expect(result.state.bank.ore).toBe(bankOreBefore + 2);
    expect(result.state.bank.wool).toBe(bankWoolBefore - 1);
    expect(result.events.some((ev) => typeOf(ev) === 'bankTraded')).toBe(true);
  });
});

describe('useNoblewoman', () => {
  it('peeks + steals 1 card from a strictly higher-VP player', () => {
    const state = withHelperAssigned(
      craft({
        place: [
          { seat: 0, settlements: [v(0).id] }, // 1 VP
          { seat: 1, settlements: [v(3).id], cities: [v(4).id], hand: { ore: 3 } }, // 3 VP
        ],
      }),
      0,
      'noblewoman'
    );
    const result = useNoblewoman(state, 0, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p0 = result.state.players.find((p) => p.seat === 0)!;
    const p1 = result.state.players.find((p) => p.seat === 1)!;
    expect(p0.resources.ore).toBe(1);
    expect(p1.resources.ore).toBe(2);
    expect(result.events.some((ev) => typeOf(ev) === 'stolen')).toBe(true);
  });

  it('NOT_ELIGIBLE when the target does not hold strictly more VP', () => {
    const state = withHelperAssigned(
      craft({ place: [{ seat: 0, settlements: [v(0).id] }, { seat: 1, settlements: [v(3).id] }] }),
      0,
      'noblewoman'
    );
    const result = useNoblewoman(state, 0, 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ELIGIBLE');
  });
});

describe('useArchitect', () => {
  it('looks at the top 3, buys the picked index, substituting 1 resource', () => {
    const state = withHelperAssigned(
      craft({ place: [{ seat: 0, hand: { wool: 2, grain: 1 } }] }),
      0,
      'architect'
    );
    const pickedCard = state.devDeck[1]!;
    const devDeckLenBefore = state.devDeck.length;
    const result = useArchitect(state, 0, 1, 'ore', 'wool');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.devDeck.length).toBe(devDeckLenBefore - 1);
    const p0 = result.state.players.find((p) => p.seat === 0)!;
    expect(p0.devCards.map((c) => c.type)).toContain(pickedCard);
    expect(p0.resources).toMatchObject({ wool: 0, grain: 0, ore: 0 });
    expect(result.events.some((ev) => typeOf(ev) === 'devBought')).toBe(true);
  });

  it('CANT_AFFORD when the substituted dev-card cost cannot be paid', () => {
    const state = withHelperAssigned(craft({ place: [{ seat: 0, hand: {} }] }), 0, 'architect');
    const result = useArchitect(state, 0, 0, 'ore', 'wool');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CANT_AFFORD');
  });

  it('a commit clears any pending peek for this seat, even one from a prior begin', () => {
    const state = withHelperAssigned(craft({ place: [{ seat: 0, hand: { wool: 2, grain: 1 } }] }), 0, 'architect');
    const ext = helpersExt(state)!;
    const withPeek: GameState = {
      ...state,
      ext: { ...state.ext, helpers: { ...ext, architectPeek: [state.devDeck.slice(0, 3), null, null, null] } },
    };
    const result = useArchitect(withPeek, 0, 1, 'ore', 'wool');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(helpersExt(result.state)!.architectPeek[0]).toBeNull();
  });
});

describe('useArchitectBeginPeek', () => {
  it('reveals the real top-3 devDeck cards into architectPeek[seat] without touching deck/bank/hand', () => {
    const state = withHelperAssigned(
      craft({ place: [{ seat: 0, hand: { wool: 2, grain: 1 } }] }),
      0,
      'architect'
    );
    const top3 = state.devDeck.slice(0, 3);
    const result = useArchitectBeginPeek(state, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(helpersExt(result.state)!.architectPeek[0]).toEqual(top3);
    // Nothing else changed: deck/bank/hand/A-B use are all untouched by a peek.
    expect(result.state.devDeck).toEqual(state.devDeck);
    expect(result.state.bank).toEqual(state.bank);
    expect(result.state.players[0]!.devCards).toEqual([]);
    expect(helpersExt(result.state)!.bySeat[0]).toEqual(helpersExt(state)!.bySeat[0]);
    expect(result.events).toEqual([]);
  });

  it('reveals nothing to any OTHER seat (their architectPeek entry stays null)', () => {
    const state = withHelperAssigned(craft({ place: [{ seat: 0, hand: {} }] }), 0, 'architect');
    const result = useArchitectBeginPeek(state, 0);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const architectPeek = helpersExt(result.state)!.architectPeek;
    expect(architectPeek[1]).toBeNull();
    expect(architectPeek[2]).toBeNull();
    expect(architectPeek[3]).toBeNull();
  });

  it('CANNOT_PLAY when the seat does not currently hold architect', () => {
    const state = craft({ place: [{ seat: 0, hand: {} }] }); // no helper assigned
    const result = useArchitectBeginPeek(state, 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CANNOT_PLAY');
  });

  it('DECK_EMPTY when the development-card deck has no cards left', () => {
    const state = withHelperAssigned(craft({ place: [{ seat: 0, hand: {} }] }), 0, 'architect');
    const empty: GameState = { ...state, devDeck: [] };
    const result = useArchitectBeginPeek(empty, 0);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DECK_EMPTY');
  });
});

describe('usePriest', () => {
  it('settlement: discards a Knight, pays the reduced 1 brick + 1 lumber', () => {
    // v0 (settlement) --edge0-- v1 --edge1-- v2: v2 is road-connected but NOT adjacent to v0, so
    // it satisfies the distance rule (adjacent-to-v1-only) unlike v1 itself would.
    const v0 = v(0);
    const edge0 = v0.edges[0]!;
    const edge0Obj = e(edge0);
    const v1 = v(edge0Obj.a === v0.id ? edge0Obj.b : edge0Obj.a);
    const edge1 = v1.edges.find((ed) => ed !== edge0)!;
    const edge1Obj = e(edge1);
    const targetVertex = (edge1Obj.a === v1.id ? edge1Obj.b : edge1Obj.a) as VertexId;
    const state = withHelperAssigned(
      craft({
        place: [
          {
            seat: 0,
            settlements: [v0.id],
            roads: [edge0, edge1],
            hand: { brick: 1, lumber: 1 },
            devCards: [{ type: 'knight', boughtOnTurn: 1 }],
          },
        ],
      }),
      0,
      'priest'
    );
    const result = usePriest(state, 0, 'settlement', targetVertex);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p0 = result.state.players.find((p) => p.seat === 0)!;
    expect(p0.settlements).toContain(targetVertex);
    expect(p0.devCards.some((c) => c.type === 'knight')).toBe(false);
    expect(p0.resources).toMatchObject({ brick: 0, lumber: 0 });
  });

  it('city: discards a Knight, pays the reduced 2 ore + 1 grain', () => {
    const v0 = v(0);
    const state = withHelperAssigned(
      craft({
        place: [
          {
            seat: 0,
            settlements: [v0.id],
            hand: { ore: 2, grain: 1 },
            devCards: [{ type: 'knight', boughtOnTurn: 1 }],
          },
        ],
      }),
      0,
      'priest'
    );
    const result = usePriest(state, 0, 'city', v0.id);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const p0 = result.state.players.find((p) => p.seat === 0)!;
    expect(p0.cities).toContain(v0.id);
    expect(p0.settlements).not.toContain(v0.id);
    expect(p0.devCards.some((c) => c.type === 'knight')).toBe(false);
  });

  it('CARD_NOT_HELD when the seat holds no Knight card', () => {
    const v0 = v(0);
    const state = withHelperAssigned(
      craft({ place: [{ seat: 0, settlements: [v0.id], hand: { ore: 2, grain: 1 } }] }),
      0,
      'priest'
    );
    const result = usePriest(state, 0, 'city', v0.id);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CARD_NOT_HELD');
  });
});
