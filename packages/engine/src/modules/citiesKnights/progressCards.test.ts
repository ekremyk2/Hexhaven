// T-804: progress-card effects (C6.5) + the C6.2 draw mechanic. Built over `createGame`'s real
// geometry (GEOMETRY), mirroring knights.test.ts/improvements.test.ts's direct-function-call style
// (these ARE this module's public API, exactly like buildKnight/promoteKnight are tested directly
// there) — reduce()/action-routing/timing is covered by the sibling t804.test.ts smoke tests.

import { describe, expect, it } from 'vitest';
import { GEOMETRY } from '@hexhaven/shared';
import type {
  CitiesKnightsExt,
  EdgeId,
  GameState,
  HexId,
  Knight,
  ProgressCardId,
  TerrainType,
  VertexId,
} from '@hexhaven/shared';
import { createGame } from '../../createGame.js';
import { computeVp } from '../../vp.js';
import { peekSpyTarget, playProgressCard, resolveProgressDraw } from './progressCards.js';

const CONFIG = {
  playerCount: 4 as const,
  targetVp: 13,
  board: 'random' as const,
  tokenMethod: 'spiral' as const,
  expansions: { fiveSix: false as const, seafarers: false as const, citiesKnights: true as const },
};

const h = (id: number) => GEOMETRY.hexes[id]!;
const vtx = (hexId: number, k: number) => h(hexId).vertices[k]! as VertexId;
const edg = (hexId: number, k: number) => h(hexId).edges[k]! as EdgeId;
const hex = (id: number) => id as HexId;

const V0 = vtx(0, 0);
const V1 = vtx(0, 1);
const E01 = edg(0, 0);

interface CraftOpts {
  players?: Partial<
    Record<
      number,
      {
        settlements?: VertexId[];
        cities?: VertexId[];
        roads?: EdgeId[];
        resources?: Partial<Record<'brick' | 'lumber' | 'wool' | 'grain' | 'ore', number>>;
        piecesLeft?: Partial<{ roads: number; settlements: number; cities: number }>;
      }
    >
  >;
  ck?: Partial<CitiesKnightsExt>;
  perSeatCk?: Partial<
    Record<
      number,
      {
        commodities?: Partial<Record<'paper' | 'cloth' | 'coin', number>>;
        improvements?: Partial<Record<'trade' | 'politics' | 'science', number>>;
        knights?: Knight[];
        progressHand?: ProgressCardId[];
      }
    >
  >;
  hexes?: { id: number; terrain: TerrainType; token: number | null }[];
  robber?: number;
}

function craft(seed: string, opts: CraftOpts = {}): GameState {
  const g = createGame({ ...CONFIG, seed });
  const players = g.players.map((p) => {
    const o = opts.players?.[p.seat];
    if (!o) return p;
    return {
      ...p,
      settlements: o.settlements ?? p.settlements,
      cities: o.cities ?? p.cities,
      roads: o.roads ?? p.roads,
      resources: { ...p.resources, ...o.resources },
      piecesLeft: { ...p.piecesLeft, ...o.piecesLeft },
    };
  });

  const base = g.ext!.citiesKnights!;
  const commodities = base.commodities.map((c, i) => ({ ...c, ...opts.perSeatCk?.[i]?.commodities }));
  const improvements = base.improvements.map((imp, i) => ({ ...imp, ...opts.perSeatCk?.[i]?.improvements }));
  const knights = base.knights.map((k, i) => opts.perSeatCk?.[i]?.knights ?? k);
  const progressHand = base.progressHand.map((h2, i) => opts.perSeatCk?.[i]?.progressHand ?? h2);
  const ck: CitiesKnightsExt = { ...base, commodities, improvements, knights, progressHand, ...opts.ck };

  let hexes = g.board.hexes;
  if (opts.hexes) {
    hexes = g.board.hexes.map((tile, i) => {
      const override = opts.hexes!.find((x) => x.id === i);
      return override ? { terrain: override.terrain, token: override.token } : tile;
    });
  }

  return {
    ...g,
    players,
    phase: { kind: 'main' },
    turn: { number: 5, player: 0, rolled: true, roll: [3, 4], devPlayed: false },
    board: { ...g.board, hexes, robber: hex(opts.robber ?? (g.board.robber as unknown as number)) },
    ext: { ...g.ext, citiesKnights: ck },
  };
}

describe('resolveProgressDraw (C6.2)', () => {
  it('draws in turn order starting with the acting seat, only for eligible seats', () => {
    const state = craft('draw-order', {
      perSeatCk: {
        0: { improvements: { science: 3 } }, // eligible red<=4
        1: { improvements: { science: 0 } }, // never eligible
        2: { improvements: { science: 1 } }, // eligible red<=2
      },
    });
    const result = resolveProgressDraw(state, 'science', 2, 1); // acting seat 1 starts turn order
    // seat1 not eligible (level 0); seat2 eligible (red 2 <= level+1=2); seat3 not eligible (level 0);
    // seat0 eligible (red 2 <= 4).
    expect(result.progressHand[2]).toHaveLength(1);
    expect(result.progressHand[0]).toHaveLength(1);
    expect(result.progressHand[1]).toHaveLength(0);
    expect(result.progressHand[3]).toHaveLength(0);
    // Turn order starting at seat 1: seat2 draws BEFORE seat0 (seat1's deck-position card differs).
    const ck = state.ext!.citiesKnights!;
    expect(result.progressHand[2]![0]).toBe(ck.progressDecks.science[0]);
    expect(result.progressHand[0]![0]).toBe(ck.progressDecks.science[1]);
  });

  it('an empty deck means that seat draws nothing', () => {
    const state = craft('draw-empty', { ck: { progressDecks: { trade: [], politics: [], science: [] } } });
    const result = resolveProgressDraw(state, 'science', 6, 0);
    expect(result.progressHand.every((h2) => h2.length === 0)).toBe(true);
  });

  it('a hand at the 4-card limit auto-discards the just-drawn card back to its own deck bottom (C6.3)', () => {
    const state = craft('draw-limit', {
      perSeatCk: {
        0: { improvements: { science: 5 }, progressHand: ['smith', 'smith', 'mining', 'irrigation'] },
      },
    });
    const ck = state.ext!.citiesKnights!;
    const topCard = ck.progressDecks.science[0]!;
    const result = resolveProgressDraw(state, 'science', 6, 0);
    expect(result.progressHand[0]).toHaveLength(4); // stayed at the limit, not 5
    expect(result.progressHand[0]).not.toContain(topCard === 'smith' ? undefined : topCard); // sanity
    expect(result.progressDecks.science.at(-1)).toBe(topCard); // discarded to the BOTTOM of its own deck
    expect(result.events.some((e) => e.type === 'progressCardDiscarded')).toBe(true);
  });

  it('Printer/Constitution are revealed immediately (+1 VP) and never enter a hand (C6.3/C1.3)', () => {
    const state = craft('draw-printer', {
      perSeatCk: { 0: { improvements: { science: 5 } } },
      ck: {
        progressDecks: {
          science: ['printer', 'smith'],
          trade: [],
          politics: [],
        },
      },
    });
    const result = resolveProgressDraw(state, 'science', 6, 0);
    expect(result.revealedProgress.printer).toBe(0);
    expect(result.progressHand[0]).not.toContain('printer');
    expect(result.events.some((e) => e.type === 'progressCardRevealed')).toBe(true);
  });
});

describe('playProgressCard: common guards', () => {
  it('rejects a card the seat does not hold (CARD_NOT_HELD)', () => {
    const state = craft('not-held');
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'warlord' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CARD_NOT_HELD');
  });

  it('Printer/Constitution can never be played (revealed-only cards)', () => {
    const state = craft('printer-unplayable', { perSeatCk: { 0: { progressHand: [] } } });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'printer' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('CARD_NOT_HELD');
  });
});

describe('card effects (C6.5)', () => {
  it('Alchemist: sets the pending forced dice and removes the card from hand', () => {
    const state = craft('alchemist', { perSeatCk: { 0: { progressHand: ['alchemist'] } } });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'alchemist', yellowDie: 3, redDie: 5 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.ext!.citiesKnights!.alchemistForced).toEqual([3, 5]);
    expect(res.state.ext!.citiesKnights!.progressHand[0]).not.toContain('alchemist');
  });

  it('Crane: advances a track for 1 fewer commodity than normal', () => {
    const state = craft('crane', {
      players: { 0: { cities: [V0] } },
      perSeatCk: { 0: { improvements: { trade: 1 }, commodities: { cloth: 1 }, progressHand: ['crane'] } },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'crane', track: 'trade' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ck = res.state.ext!.citiesKnights!;
    expect(ck.improvements[0]!.trade).toBe(2);
    expect(ck.commodities[0]!.cloth).toBe(0); // paid 1 (level-2 cost is 2, discounted by 1), not 2
  });

  it('Engineer: builds a city wall for free', () => {
    const state = craft('engineer', {
      players: { 0: { cities: [V0], resources: { brick: 0 } } },
      perSeatCk: { 0: { progressHand: ['engineer'] } },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'engineer', vertex: V0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.ext!.citiesKnights!.walls[0]).toContain(V0);
    expect(res.state.players[0]!.resources.brick).toBe(0); // free
  });

  it('Inventor: swaps two hexes’ number tokens (excluding 6/8)', () => {
    const state = craft('inventor', {
      hexes: [
        { id: 0, terrain: 'forest', token: 5 },
        { id: 1, terrain: 'pasture', token: 9 },
      ],
      perSeatCk: { 0: { progressHand: ['inventor'] } },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'inventor', hexA: hex(0), hexB: hex(1) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.board.hexes[0]!.token).toBe(9);
    expect(res.state.board.hexes[1]!.token).toBe(5);
  });

  it('Inventor: rejects relocating a 6 or 8 token', () => {
    const state = craft('inventor-restricted', {
      hexes: [
        { id: 0, terrain: 'forest', token: 6 },
        { id: 1, terrain: 'pasture', token: 9 },
      ],
      perSeatCk: { 0: { progressHand: ['inventor'] } },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'inventor', hexA: hex(0), hexB: hex(1) });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('INVENTOR_RESTRICTED_NUMBER');
  });

  it('Irrigation: gains 2 grain per fields hex bordered', () => {
    const state = craft('irrigation', {
      players: { 0: { settlements: [V0] } },
      hexes: [{ id: 0, terrain: 'fields', token: 5 }],
      perSeatCk: { 0: { progressHand: ['irrigation'] } },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'irrigation' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.grain).toBe(state.players[0]!.resources.grain + 2);
  });

  it('Mining: gains 2 ore per mountains hex bordered', () => {
    const state = craft('mining', {
      players: { 0: { settlements: [V0] } },
      hexes: [{ id: 0, terrain: 'mountains', token: 5 }],
      perSeatCk: { 0: { progressHand: ['mining'] } },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'mining' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.ore).toBe(state.players[0]!.resources.ore + 2);
  });

  it('Medicine: upgrades settlement->city for 2 ore + 1 grain', () => {
    const state = craft('medicine', {
      players: { 0: { settlements: [V0], resources: { ore: 2, grain: 1 } } },
      perSeatCk: { 0: { progressHand: ['medicine'] } },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'medicine', vertex: V0 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.cities).toContain(V0);
    expect(res.state.players[0]!.resources.ore).toBe(0);
    expect(res.state.players[0]!.resources.grain).toBe(0);
  });

  it('Smith: promotes up to 2 knights one level, free', () => {
    const state = craft('smith', {
      perSeatCk: {
        0: {
          knights: [
            { vertex: V0, level: 1, active: false },
            { vertex: V1, level: 1, active: false },
          ],
          progressHand: ['smith'],
        },
      },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'smith' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const knights = res.state.ext!.citiesKnights!.knights[0]!;
    expect(knights.every((k) => k.level === 2)).toBe(true);
  });

  it('Warlord: activates all your inactive knights, free', () => {
    const state = craft('warlord', {
      players: { 0: { resources: { grain: 0 } } },
      perSeatCk: {
        0: {
          knights: [
            { vertex: V0, level: 1, active: false },
            { vertex: V1, level: 2, active: true },
          ],
          progressHand: ['warlord'],
        },
      },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'warlord' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const knights = res.state.ext!.citiesKnights!.knights[0]!;
    expect(knights.every((k) => k.active)).toBe(true);
    expect(res.state.players[0]!.resources.grain).toBe(0); // free
  });

  it('Merchant: places the merchant piece on a hex touching your settlement/city', () => {
    const state = craft('merchant', {
      players: { 0: { settlements: [V0] } },
      perSeatCk: { 0: { progressHand: ['merchant'] } },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'merchant', hex: hex(0) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.ext!.citiesKnights!.merchant).toEqual({ hex: 0, owner: 0 });
    expect(computeVp(res.state, 0).merchant).toBe(1);
  });

  it('Merchant Fleet: one immediate 2:1 trade (documented simplification of "until end of turn")', () => {
    const state = craft('merchant-fleet', {
      players: { 0: { resources: { ore: 2, brick: 0 } } },
      perSeatCk: { 0: { progressHand: ['merchantFleet'] } },
    });
    const res = playProgressCard(state, 0, {
      type: 'playProgressCard',
      card: 'merchantFleet',
      give: 'ore',
      receive: 'brick',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.ore).toBe(0);
    expect(res.state.players[0]!.resources.brick).toBe(1);
  });

  it('Commercial Harbor: each opponent holding the resource swaps it for one of your commodities', () => {
    const state = craft('commercial-harbor', {
      players: { 1: { resources: { brick: 1 } }, 2: { resources: { brick: 0 } } },
      perSeatCk: { 0: { commodities: { coin: 2 }, progressHand: ['commercialHarbor'] } },
    });
    const res = playProgressCard(state, 0, {
      type: 'playProgressCard',
      card: 'commercialHarbor',
      resource: 'brick',
      commodity: 'coin',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.brick).toBe(1);
    expect(res.state.players[1]!.resources.brick).toBe(0);
    expect(res.state.ext!.citiesKnights!.commodities[1]!.coin).toBe(1);
    expect(res.state.ext!.citiesKnights!.commodities[0]!.coin).toBe(1); // paid 1 of 2
  });

  it('Master Merchant: takes 2 cards from a player with strictly more VP', () => {
    const state = craft('master-merchant', {
      players: { 1: { cities: [V0, V1], resources: { ore: 3, grain: 1 } } },
      perSeatCk: { 0: { progressHand: ['masterMerchant'] } },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'masterMerchant', targetSeat: 1 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.ore).toBe(state.players[0]!.resources.ore + 2);
    expect(res.state.players[1]!.resources.ore).toBe(1);
  });

  it('Master Merchant: rejects a target without strictly more VP (NOT_ELIGIBLE)', () => {
    const state = craft('master-merchant-ineligible', { perSeatCk: { 0: { progressHand: ['masterMerchant'] } } });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'masterMerchant', targetSeat: 1 });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('NOT_ELIGIBLE');
  });

  it('Resource Monopoly: each other player gives up to 2 of a named resource', () => {
    const state = craft('resource-monopoly', {
      players: { 1: { resources: { wool: 3 } }, 2: { resources: { wool: 1 } }, 3: { resources: { wool: 0 } } },
      perSeatCk: { 0: { progressHand: ['resourceMonopoly'] } },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'resourceMonopoly', resource: 'wool' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.wool).toBe(state.players[0]!.resources.wool + 3); // 2 + 1 + 0
    expect(res.state.players[1]!.resources.wool).toBe(1);
    expect(res.state.players[2]!.resources.wool).toBe(0);
  });

  it('Commodity Monopoly: each other player gives 1 of a named commodity', () => {
    const state = craft('commodity-monopoly', {
      perSeatCk: {
        0: { progressHand: ['commodityMonopoly'] },
        1: { commodities: { paper: 2 } },
        2: { commodities: { paper: 1 } },
      },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'commodityMonopoly', commodity: 'paper' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.ext!.citiesKnights!.commodities[0]!.paper).toBe(2);
    expect(res.state.ext!.citiesKnights!.commodities[1]!.paper).toBe(1);
    expect(res.state.ext!.citiesKnights!.commodities[2]!.paper).toBe(0);
  });

  it('Bishop: moves the robber and steals from EVERY adjacent player', () => {
    const targetHex = 1;
    const state = craft('bishop', {
      players: {
        1: { settlements: [vtx(targetHex, 0)], resources: { brick: 1 } },
        2: { settlements: [vtx(targetHex, 2)], resources: { ore: 1 } },
      },
      ck: { robberLocked: false },
      perSeatCk: { 0: { progressHand: ['bishop'] } },
      robber: 5,
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'bishop', hex: hex(targetHex) });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.board.robber).toBe(targetHex);
    const stolenEvents = res.events.filter((e) => e.type === 'stolen');
    expect(stolenEvents).toHaveLength(2);
  });

  it('Bishop: rejects while the robber is locked (C10.1)', () => {
    const state = craft('bishop-locked', {
      ck: { robberLocked: true },
      perSeatCk: { 0: { progressHand: ['bishop'] } },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'bishop', hex: hex(1) });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('ROBBER_LOCKED');
  });

  it('Deserter: removes an opponent knight and places a free knight of the same level for you', () => {
    const state = craft('deserter', {
      players: { 0: { roads: [E01] } },
      perSeatCk: {
        0: { progressHand: ['deserter'] },
        1: { knights: [{ vertex: V1, level: 2, active: false }] },
      },
    });
    const res = playProgressCard(state, 0, {
      type: 'playProgressCard',
      card: 'deserter',
      targetSeat: 1,
      targetVertex: V1,
      vertex: V0,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ck = res.state.ext!.citiesKnights!;
    expect(ck.knights[1]).toHaveLength(0);
    expect(ck.knights[0]).toEqual([{ vertex: V0, level: 2, active: false }]);
  });

  it('Diplomat: removes an opponent’s open road', () => {
    const state = craft('diplomat', {
      players: { 1: { roads: [E01] } },
      perSeatCk: { 0: { progressHand: ['diplomat'] } },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'diplomat', edge: E01 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[1]!.roads).not.toContain(E01);
    expect(res.state.players[1]!.piecesLeft.roads).toBe(state.players[1]!.piecesLeft.roads + 1);
  });

  it('Diplomat: rebuilds your OWN removed road for free', () => {
    const state = craft('diplomat-own', {
      players: { 0: { roads: [E01] } },
      perSeatCk: { 0: { progressHand: ['diplomat'] } },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'diplomat', edge: E01 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.roads).toContain(E01); // removed then rebuilt free -> net unchanged
    expect(res.events.some((e) => e.type === 'roadRemoved')).toBe(true);
  });

  it('Intrigue: displaces an opponent knight sitting on YOUR road, ignoring strength', () => {
    const state = craft('intrigue', {
      players: { 0: { roads: [E01] } },
      perSeatCk: {
        0: { progressHand: ['intrigue'] },
        1: { knights: [{ vertex: V1, level: 3, active: true }] }, // stronger than anything seat0 has
      },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'intrigue', targetVertex: V1 });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    // seat1 has no other road-connected empty vertex in this minimal setup -> the knight is removed.
    expect(res.state.ext!.citiesKnights!.knights[1]).toHaveLength(0);
  });

  it('Saboteur: every player with >= your VP discards half their (resource) hand', () => {
    const state = craft('saboteur', {
      players: {
        1: { cities: [V0], resources: { brick: 4, lumber: 0, wool: 0, grain: 0, ore: 0 } }, // VP 2 >= 0
        3: { resources: { brick: 4 } }, // 0 VP, still >= 0 -> also discards
      },
      perSeatCk: { 0: { progressHand: ['saboteur'] } },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'saboteur' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[1]!.resources.brick).toBe(2); // discarded floor(4/2)=2
    expect(res.state.players[3]!.resources.brick).toBe(2);
    expect(res.events.filter((e) => e.type === 'discarded')).toHaveLength(2);
  });

  it('Spy: takes 1 named progress card from another seat’s hand', () => {
    const state = craft('spy', {
      perSeatCk: { 0: { progressHand: ['spy'] }, 1: { progressHand: ['bishop', 'warlord'] } },
    });
    const res = playProgressCard(state, 0, {
      type: 'playProgressCard',
      card: 'spy',
      targetSeat: 1,
      targetCard: 'bishop',
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ck = res.state.ext!.citiesKnights!;
    expect(ck.progressHand[0]).toContain('bishop');
    expect(ck.progressHand[1]).toEqual(['warlord']);
  });

  it('Spy: takes a card by POSITION when targetCardIndex is given (T-806, hidden-hand client path)', () => {
    const state = craft('spy-idx', {
      perSeatCk: { 0: { progressHand: ['spy'] }, 1: { progressHand: ['bishop', 'warlord'] } },
    });
    const res = playProgressCard(state, 0, {
      type: 'playProgressCard',
      card: 'spy',
      targetSeat: 1,
      targetCardIndex: 1, // takes 'warlord' (index 1), leaving 'bishop'
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const ck = res.state.ext!.citiesKnights!;
    expect(ck.progressHand[0]).toContain('warlord');
    expect(ck.progressHand[1]).toEqual(['bishop']);
  });

  it('Spy: rejects an out-of-range targetCardIndex (BAD_CARD_TARGET)', () => {
    const state = craft('spy-oob', {
      perSeatCk: { 0: { progressHand: ['spy'] }, 1: { progressHand: ['bishop'] } },
    });
    const res = playProgressCard(state, 0, {
      type: 'playProgressCard',
      card: 'spy',
      targetSeat: 1,
      targetCardIndex: 5,
    });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error.code).toBe('BAD_CARD_TARGET');
  });

  describe('peekSpyTarget (peek reveal fix, redact.ts hidden-info UX)', () => {
    it("snapshots the target's REAL hand into spyPeek[seat] without moving any card", () => {
      const state = craft('spy-peek', {
        perSeatCk: { 0: { progressHand: ['spy'] }, 1: { progressHand: ['bishop', 'warlord'] } },
      });
      const res = peekSpyTarget(state, 0, 1);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const ck = res.state.ext!.citiesKnights!;
      expect(ck.spyPeek[0]).toEqual({ targetSeat: 1, cards: ['bishop', 'warlord'] });
      // Nothing moved: both hands are exactly as before.
      expect(ck.progressHand[0]).toEqual(['spy']);
      expect(ck.progressHand[1]).toEqual(['bishop', 'warlord']);
      expect(res.events).toEqual([]);
    });

    it('reveals nothing into any OTHER seat’s spyPeek entry', () => {
      const state = craft('spy-peek-others', {
        perSeatCk: { 0: { progressHand: ['spy'] }, 1: { progressHand: ['bishop'] } },
      });
      const res = peekSpyTarget(state, 0, 1);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const ck = res.state.ext!.citiesKnights!;
      expect(ck.spyPeek[1]).toBeNull();
      expect(ck.spyPeek[2]).toBeNull();
      expect(ck.spyPeek[3]).toBeNull();
    });

    it('CARD_NOT_HELD when the seat does not hold spy', () => {
      const state = craft('spy-peek-not-held', {
        perSeatCk: { 0: { progressHand: [] }, 1: { progressHand: ['bishop'] } },
      });
      const res = peekSpyTarget(state, 0, 1);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('CARD_NOT_HELD');
    });

    it('BAD_CARD_TARGET when targeting itself', () => {
      const state = craft('spy-peek-self', { perSeatCk: { 0: { progressHand: ['spy'] } } });
      const res = peekSpyTarget(state, 0, 0);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.error.code).toBe('BAD_CARD_TARGET');
    });

    it('a subsequent commit (real targetCard) clears the pending peek for that seat', () => {
      const state = craft('spy-peek-commit', {
        perSeatCk: { 0: { progressHand: ['spy'] }, 1: { progressHand: ['bishop', 'warlord'] } },
      });
      const peeked = peekSpyTarget(state, 0, 1);
      expect(peeked.ok).toBe(true);
      if (!peeked.ok) return;
      expect(peeked.state.ext!.citiesKnights!.spyPeek[0]).not.toBeNull();
      const committed = playProgressCard(peeked.state, 0, {
        type: 'playProgressCard',
        card: 'spy',
        targetSeat: 1,
        targetCard: 'bishop',
      });
      expect(committed.ok).toBe(true);
      if (!committed.ok) return;
      expect(committed.state.ext!.citiesKnights!.spyPeek[0]).toBeNull();
      expect(committed.state.ext!.citiesKnights!.progressHand[0]).toContain('bishop');
    });
  });

  it('Wedding: every player with strictly more VP gives you up to 2 cards', () => {
    const state = craft('wedding', {
      players: { 1: { cities: [V0], resources: { ore: 3 } } }, // 2 VP > seat0's 0
      perSeatCk: { 0: { progressHand: ['wedding'] } },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'wedding' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.players[0]!.resources.ore).toBe(state.players[0]!.resources.ore + 2);
    expect(res.state.players[1]!.resources.ore).toBe(1);
  });

  it('Road Building: opens the free-road sub-phase (reuses the base roadBuilding phase)', () => {
    const state = craft('road-building', {
      players: { 0: { settlements: [V0], roads: [] } },
      perSeatCk: { 0: { progressHand: ['roadBuilding'] } },
    });
    const res = playProgressCard(state, 0, { type: 'playProgressCard', card: 'roadBuilding' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.state.phase).toEqual({ kind: 'roadBuilding', remaining: 2 });
  });
});
