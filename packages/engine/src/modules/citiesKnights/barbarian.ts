// Cities & Knights event die + barbarian attack (T-803, docs/rules/cities-knights-rules.md C5/C8).
// Pure helpers consumed by the module's `afterAction` roll hook (index.ts) — no engine state is
// threaded here except the rng, so every draw/resolution is independently unit-testable.

import type { CitiesKnightsExt, EventDieFace, ImprovementTrack, PlayerState, Seat, VertexId } from '@hexhaven/shared';
import { pickIndex } from '../../rng.js';

const TRACKS: readonly ImprovementTrack[] = ['trade', 'politics', 'science'];

/**
 * C5.1: the event die's 6 faces — 3 (physically distinct but effect-identical, C8.1) "barbarian
 * ship" faces and one face per colour/track. Faces 0-2 -> ship, 3 -> trade(yellow), 4 ->
 * politics(blue), 5 -> science(green); an arbitrary but deterministic index->face mapping (the
 * rulebook doesn't assign face identities beyond "3 ship + 1 each colour").
 */
export function rollEventDie(rng: number): { state: number; face: EventDieFace } {
  const draw = pickIndex(rng, 6);
  const face: EventDieFace =
    draw.value < 3 ? 'ship' : draw.value === 3 ? 'trade' : draw.value === 4 ? 'politics' : 'science';
  return { state: draw.state, face };
}

/** C8.3: sum of each seat's ACTIVE knight strengths (inactive knights don't count, C7.5). */
function perSeatDefense(knights: CitiesKnightsExt['knights']): number[] {
  return knights.map((list) => list.reduce((sum, k) => sum + (k.active ? k.level : 0), 0));
}

export interface BarbarianAttackResult {
  players: PlayerState[];
  walls: VertexId[][];
  attackStrength: number;
  defenseStrength: number;
  result: 'defended' | 'defeated';
  /** C8.5: the single highest-defense seat, or `null` on a tie (nobody becomes Defender). */
  defenderSeat: Seat | null;
  /** C8.5: non-empty only when `result` is 'defended' and there was a tie for highest defense. */
  tiedSeats: Seat[];
  /** C8.6: each city downgraded to a settlement (its wall destroyed alongside). */
  pillaged: { seat: Seat; vertex: VertexId }[];
}

/**
 * C8.2-C8.7: resolve one barbarian attack from the CURRENT (pre-this-roll) players/knights/
 * metropolis state. Does NOT reset the ship position or deactivate knights — the caller (index.ts)
 * does that unconditionally after ANY attack (C8.7), win or lose, since that reset is identical
 * regardless of this function's outcome.
 */
export function resolveBarbarianAttack(
  players: readonly PlayerState[],
  ck: CitiesKnightsExt
): BarbarianAttackResult {
  // C8.3: attack strength = total cities + metropolises across ALL players. A metropolis sits ON a
  // city (already counted in `cities`), so C8.3's "cities + metropolises" is read as cities counted
  // once each PLUS one extra per metropolis in play (at most 3) — not a double-count of the same
  // building as two different things, just the metropolis's own extra contribution.
  const attackStrength =
    players.reduce((sum, p) => sum + p.cities.length, 0) + TRACKS.filter((t) => ck.metropolis[t] !== null).length;

  const defense = perSeatDefense(ck.knights);
  const defenseStrength = defense.reduce((a, b) => a + b, 0);

  if (defenseStrength >= attackStrength) {
    // C8.4/C8.5: ties DEFEND; the single highest-defense seat becomes Defender of Hexhaven. A tie for
    // highest (including an all-zero tie when nobody has any knights) means no defender at all.
    const max = Math.max(...defense);
    const topSeats = defense
      .map((v, seat) => ({ seat: seat as Seat, v }))
      .filter((e) => e.v === max)
      .map((e) => e.seat);
    const defenderSeat = topSeats.length === 1 ? topSeats[0]! : null;
    return {
      players: players.map((p) => ({ ...p })),
      walls: ck.walls.map((w) => [...w]),
      attackStrength,
      defenseStrength,
      result: 'defended',
      defenderSeat,
      tiedSeats: defenderSeat === null ? topSeats : [],
      pillaged: [],
    };
  }

  // C8.6: barbarians win. Every seat at the LOWEST per-seat defense (0 counts) loses one city.
  const min = Math.min(...defense);
  const loserSeats = defense
    .map((v, seat) => ({ seat: seat as Seat, v }))
    .filter((e) => e.v === min)
    .map((e) => e.seat);

  const outPlayers = players.map((p) => ({ ...p }));
  const walls = ck.walls.map((w) => [...w]);
  const pillaged: { seat: Seat; vertex: VertexId }[] = [];

  for (const seat of loserSeats) {
    const p = outPlayers[seat]!;
    // ⚠ Documented simplification (mirrors improvements.ts's C4.3 note): `CitiesKnightsExt.metropolis`
    // tracks OWNERSHIP per track, not which vertex holds the piece, so a metropolis-immune city
    // (C8.6) can't be identified precisely. A seat holding `metroCount` metropolises is treated as
    // having exactly that many of their cities immune; if their remaining (non-immune) city count is
    // 0, C8.6's "only metropolises -> loses nothing" applies exactly. Otherwise the LOWEST-VertexId
    // city is the one downgraded — an arbitrary but deterministic choice given the data model can't
    // name the metropolis vertex. A vertex-precise metropolis model would remove this approximation.
    const metroCount = TRACKS.filter((t) => ck.metropolis[t] === seat).length;
    if (p.cities.length <= metroCount) continue;
    // T-807 fix: a pillaged city downgrades to a settlement (R7.5's inverse — the settlement piece
    // that a `buildCity` upgrade returns to supply must come back out of supply here). A seat who
    // has placed EVERY settlement piece as an actual settlement elsewhere (piecesLeft.settlements
    // === 0 — the maximal 5-settlement + 4-city, 9-building board) has no physical piece left to
    // represent a 6th settlement; the rulebook doesn't address this corner. The previous
    // `Math.max(0, ...)` clamp silently fabricated a 6th settlement piece out of nowhere, breaking
    // I2's piece-supply conservation; simply REMOVING the city instead (no settlement placed) is
    // also wrong — I5 connectivity showed that vertex can be the sole anchor for a branch of this
    // seat's own road network, so deleting the building without a replacement orphans those roads
    // (both caught by T-807's simulation gate). The only choice that preserves every base invariant
    // is to treat this seat as immune THIS attack (their city is safe — mirrors the existing
    // metropolis-immunity `continue` just above) until a piece returns to their supply.
    if (p.piecesLeft.settlements <= 0) continue;
    const vertex = [...p.cities].sort((a, b) => a - b)[0]!;
    outPlayers[seat] = {
      ...p,
      cities: p.cities.filter((c) => c !== vertex),
      settlements: [...p.settlements, vertex],
      piecesLeft: {
        ...p.piecesLeft,
        settlements: p.piecesLeft.settlements - 1,
        cities: p.piecesLeft.cities + 1,
      },
    };
    walls[seat] = walls[seat]!.filter((v) => v !== vertex);
    pillaged.push({ seat, vertex });
  }

  return {
    players: outPlayers,
    walls,
    attackStrength,
    defenseStrength,
    result: 'defeated',
    defenderSeat: null,
    tiedSeats: [],
    pillaged,
  };
}
