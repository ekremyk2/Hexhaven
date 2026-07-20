// Game constants transcribed from docs/03-data-model.md §2

import type { ImprovementTrack, KnightLevel, ProgressCardId } from './types.js';

export type ResourceType = 'brick' | 'lumber' | 'wool' | 'grain' | 'ore';
export type TerrainType = 'hills' | 'forest' | 'pasture' | 'fields' | 'mountains' | 'desert';
export type DevCardType = 'knight' | 'roadBuilding' | 'yearOfPlenty' | 'monopoly' | 'victoryPoint';
export type HarborType = ResourceType | 'generic';
export type Seat = 0 | 1 | 2 | 3 | 4 | 5;
export type PlayerColor = 'red' | 'blue' | 'white' | 'orange' | 'green' | 'brown';

export const TERRAIN_RESOURCE: Record<TerrainType, ResourceType | null> = {
  hills: 'brick',
  forest: 'lumber',
  pasture: 'wool',
  fields: 'grain',
  mountains: 'ore',
  desert: null,
};

export const TERRAIN_COUNTS = { hills: 3, forest: 4, pasture: 4, fields: 4, mountains: 3, desert: 1 };

export const TOKEN_SPIRAL = [5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11];

export const HARBOR_MIX: HarborType[] = [
  'generic',
  'generic',
  'generic',
  'generic',
  'brick',
  'lumber',
  'wool',
  'grain',
  'ore',
];

export const BANK_PER_RESOURCE = 19;

export const DEV_DECK = {
  knight: 14,
  roadBuilding: 2,
  yearOfPlenty: 2,
  monopoly: 2,
  victoryPoint: 5,
};

export const PIECES_PER_PLAYER = { roads: 15, settlements: 5, cities: 4 };

export const COSTS: Record<
  'road' | 'settlement' | 'city' | 'devCard',
  Partial<Record<ResourceType, number>>
> = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, wool: 1, grain: 1 },
  city: { ore: 3, grain: 2 },
  devCard: { ore: 1, wool: 1, grain: 1 },
};

export const TARGET_VP = 10;

export const DISCARD_THRESHOLD = 7;

/** The value a "limitless" customConstants limit (docs/07 D-034, config `null`) resolves to — a
 *  large FINITE cap, NOT `Infinity`. `Infinity` cannot survive JSON serialization (`JSON.stringify`
 *  turns it into `null`), so an Infinity `piecesLeft`/`targetVp` arrived at the client as `null` and
 *  read as 0 → "max, can't build" for humans while server-side bots (on the in-memory Infinity)
 *  built fine (playtest bug). A large finite cap serializes cleanly and is effectively unlimited
 *  (the board itself caps real placement). Must exceed every configurable MAX_* cap so
 *  `>= LIMITLESS_CAP` unambiguously means "limitless". */
export const LIMITLESS_CAP = 100_000;

export type ResourceBundle = Partial<Record<ResourceType, number>>;

// ---------------------------------------------------------------------------
// 5–6 Player Extension constants (docs/10 §4, docs/rules/fivesix-rules.md).
// Module-tunable overrides resolved at createGame; base engine code must never
// read these directly (docs/03 §8). All figures verified against the official
// rulebooks (2015 Mayfair printing + 2022 HEXHAVEN Studio revision).
// ---------------------------------------------------------------------------

/**
 * X2/X3: the 30-hex terrain multiset for 5–6 players — base 19 plus the +11 hexes
 * (1 desert, 2 each of the five resource terrains). Two deserts, 28 numbered hexes.
 */
export const EXT56_TERRAIN_COUNTS: Record<TerrainType, number> = {
  hills: 5,
  forest: 6,
  pasture: 6,
  fields: 6,
  mountains: 5,
  desert: 2,
};

/**
 * X4: the 28-token number multiset for 5–6 — base 18 plus one extra of each value
 * 2,3,4,5,6,8,9,10,11,12 (no 7). Ordered here for `tokenMethod:'spiral'` placement.
 *
 * The exact official letter→number mapping (tokens A…Y, ZA, ZB, ZC) is a low-resolution
 * example board in the rulebook and could not be transcribed with confidence; per the
 * D-016 precedent (harbor spots are "gameplay-equivalent, exact printed match is a stretch
 * verification, not MVP") this sequence reproduces the verified multiset in a deterministic
 * spiral order. See docs/rules/fivesix-rules.md ER-X1.
 */
export const EXT56_TOKEN_SPIRAL = [
  5, 2, 6, 3, 8, 10, 9, 12, 11, 4, 8, 10, 9, 4, 5, 6, 3, 11, // the base-18 sequence
  8, 4, 10, 9, 3, 5, 6, 11, 2, 12, // + one each of 2,3,4,5,6,8,9,10,11,12
];

/**
 * X5: the 11-harbor mix for 5–6 — base 9 (4 generic + one 2:1 per resource) plus the +2
 * frame harbors (1 generic 3:1, 1 wool 2:1) → 5 generic, 2 wool, 1 each brick/lumber/grain/ore.
 */
export const EXT56_HARBOR_MIX: HarborType[] = [
  'generic',
  'generic',
  'generic',
  'generic',
  'generic',
  'wool',
  'wool',
  'brick',
  'lumber',
  'grain',
  'ore',
];

/** X6: +5 of each resource → bank of 24 per resource (120 cards). */
export const EXT56_BANK_PER_RESOURCE = 24;

/** X7: +9 dev cards (6 knight, 1 each Road Building / Year of Plenty / Monopoly; no VP). */
export const EXT56_DEV_DECK = {
  knight: 20,
  roadBuilding: 3,
  yearOfPlenty: 3,
  monopoly: 3,
  victoryPoint: 5,
};

// ---------------------------------------------------------------------------
// Cities & Knights constants (T-801 data-model scaffolding, docs/rules/cities-knights-rules.md).
// Resolved by the (currently dormant) citiesKnights RuleModule once T-802+ wires it into
// `resolveModules`/`resolveConstants`; base engine code must never read these directly (docs/03 §8).
// ---------------------------------------------------------------------------

/** C1.1: C&K's target VP (overrides base `TARGET_VP` of 10). */
export const CK_TARGET_VP = 13;

/**
 * C8.2 ⚠ PROVISIONAL — flagged unresolved from text sources alone
 * (docs/rules/cities-knights-rules.md C8.2); verify against the physical board before/during T-803.
 * Ship-symbol advances before the barbarians attack; kept as a single named constant so a
 * correction is a one-liner.
 */
export const CK_BARBARIAN_STEPS_TO_ATTACK = 7;

/** C3.1: bank supply per commodity (3 × 12 = 36 total, alongside the 5 base resources). */
export const CK_COMMODITY_SUPPLY = 12;

/** C7.1: knight-piece cap per player, keyed by level (2 basic, 2 strong, 2 mighty). */
export const CK_KNIGHT_CAP: Readonly<Record<KnightLevel, number>> = { 1: 2, 2: 2, 3: 2 };

/** C6.3: progress-card hand limit before an immediate discard-to-deck-bottom (Printer/Constitution
 *  are revealed +1 VP cards and don't count toward this limit — C1.3/C6.3). */
export const CK_PROGRESS_HAND_LIMIT = 4;

/** C3.4/C9.2: the 7-discard hand limit is base 7, +2 per built city wall, up to `CK_MAX_WALLS`. */
export const CK_DISCARD_LIMIT_BASE = 7;
export const CK_DISCARD_LIMIT_PER_WALL = 2;

/** C9.1: at most 3 city walls per player, one per city. */
export const CK_MAX_WALLS = 3;

/** C4.2: cost (in the track's own commodity) to advance to level L is exactly L, one level at a
 *  time. */
export function ckImprovementCost(level: 1 | 2 | 3 | 4 | 5): number {
  return level;
}

/** C4.4: a track at level L is eligible to draw its colour's progress card when the red die ≤ L+1
 *  (level 0 never draws). */
export function ckCardDrawEligible(level: number, redDie: number): boolean {
  return level > 0 && redDie <= level + 1;
}

/**
 * C6.5 catalog: each track's progress-card composition (name × copy count). Each list MUST sum to
 * 18 (54 total) — enforced by citiesKnights.test.ts.
 */
export const CK_PROGRESS_DECK_COMPOSITION: Readonly<
  Record<ImprovementTrack, ReadonlyArray<{ card: ProgressCardId; count: number }>>
> = {
  science: [
    { card: 'alchemist', count: 2 },
    { card: 'crane', count: 2 },
    { card: 'engineer', count: 1 },
    { card: 'inventor', count: 2 },
    { card: 'irrigation', count: 2 },
    { card: 'medicine', count: 2 },
    { card: 'mining', count: 2 },
    { card: 'printer', count: 1 },
    { card: 'roadBuilding', count: 2 },
    { card: 'smith', count: 2 },
  ],
  trade: [
    { card: 'merchant', count: 6 },
    { card: 'merchantFleet', count: 2 },
    { card: 'commercialHarbor', count: 2 },
    { card: 'masterMerchant', count: 2 },
    { card: 'resourceMonopoly', count: 4 },
    { card: 'commodityMonopoly', count: 2 },
  ],
  politics: [
    { card: 'bishop', count: 2 },
    { card: 'constitution', count: 1 },
    { card: 'deserter', count: 2 },
    { card: 'diplomat', count: 2 },
    { card: 'intrigue', count: 2 },
    { card: 'saboteur', count: 2 },
    { card: 'spy', count: 3 },
    { card: 'warlord', count: 2 },
    { card: 'wedding', count: 2 },
  ],
};

/**
 * Expand a track's `{card,count}` composition into one entry per physical card (C6.5), in
 * deterministic (unshuffled) name order — the citiesKnights module shuffles this with the seeded
 * rng (docs/05 §2) rather than any inherent randomness here.
 */
export function ckDeckCards(track: ImprovementTrack): ProgressCardId[] {
  const out: ProgressCardId[] = [];
  for (const { card, count } of CK_PROGRESS_DECK_COMPOSITION[track]) {
    for (let i = 0; i < count; i++) out.push(card);
  }
  return out;
}

/**
 * T-804: reverse lookup from a progress-card NAME to its deck/colour (C6.1/C6.5) — used by the
 * hand-limit auto-discard (a card must go back to the bottom of ITS OWN deck) and by Spy/Master
 * Merchant-style transfers that move a named card between hands. Derived once from
 * `CK_PROGRESS_DECK_COMPOSITION` so the two tables can never drift.
 */
export const CK_CARD_TRACK: Readonly<Record<ProgressCardId, ImprovementTrack>> = (() => {
  const map = {} as Record<ProgressCardId, ImprovementTrack>;
  for (const track of ['science', 'trade', 'politics'] as const) {
    for (const { card } of CK_PROGRESS_DECK_COMPOSITION[track]) map[card] = track;
  }
  return map;
})();
