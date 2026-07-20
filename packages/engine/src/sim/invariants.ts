// T-112: `checkInvariants(prev, action, next, events, acc)` — asserts I1–I9 (docs/03 §7) after
// every successful `reduce` transition during a simulated game, plus event sanity (every accepted
// action emits at least one event). I10 (a game terminates within 4,000 actions) and the I9 replay
// spot-check are whole-GAME properties, not single-transition ones — sim/runGame.ts checks those.
//
// Every check here is a from-scratch recomputation over `next` (and, where an invariant is about a
// DELTA, over `prev`/`events` too) — never a read of some cached flag the engine itself set. That
// is the entire point of an invariant suite: it must be able to catch a bug in the very code it is
// cross-checking.

import type {
  Action,
  AnyDevCardId,
  BoardGeometry,
  EdgeId,
  GameEvent,
  GameState,
  PlayerState,
  ResourceType,
  Seat,
  VertexId,
} from '@hexhaven/shared';
import { computeVp, winTargetFor } from '../vp.js';
import { longestRoadLength, updateLongestRoad } from '../rules/longestRoad.js';
import { updateLargestArmy } from '../rules/awards.js';
import { geometryForState, resolveBoardParams, resolveConstants } from '../modules/index.js';
import { harborSettlementsOf } from '../modules/explorersPirates/state.js';
import { SHIPS_PER_PLAYER, isWondersOfHexhavenState, wonderComplete } from '../modules/seafarers/index.js';
import { bridgesOf, isCaravansState, isRiversState } from '../modules/tradersBarbarians/state.js';
import { longestRoadBruteForce } from './longestRoadBruteForce.js';

const RESOURCE_TYPES: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];
// T-904 (cardMods): the 6 curated new dev-card types conserve exactly like the base 5 (each has a
// real 1:1 `devPlayed` event) so they're included here too. cardMods' 5 COMBO ids are deliberately
// EXCLUDED — they never occupy a deck/hand slot (each one-shot consumes existing base cards), so
// they're not part of `devDeckComposition` to conserve against; `updatePlayedDevCards` below simply
// ignores any `devPlayed.card` that isn't a member of this list (ER: a combo play's `devPlayed`
// event is one of those unrecognized ids — the two BASE cards it actually consumed are already
// reflected directly in `state.players[].devCards`/`state.devDeck`, just not separately credited to
// `playedDevCards` — a known, documented simplification, not a false invariant failure).
const DEV_TYPES: readonly AnyDevCardId[] = [
  'knight',
  'roadBuilding',
  'yearOfPlenty',
  'monopoly',
  'victoryPoint',
  'bumperCrop',
  'merchantsBoon',
  'roadToll',
  'trailblazer',
  'windfall',
  'highwayman',
];

export class InvariantViolationError extends Error {
  constructor(
    public readonly invariant: string,
    message: string
  ) {
    super(`${invariant}: ${message}`);
    this.name = 'InvariantViolationError';
  }
}

/** Cumulative dev-card-play counts threaded across a whole game (I3 needs a running total — a
 * played dev card, other than the knight count already tracked in `PlayerState`, leaves no trace
 * in `GameState` itself, so the invariant checker must keep its own tally from `devPlayed` events. */
export interface InvariantAccumulator {
  playedDevCards: Readonly<Record<AnyDevCardId, number>>;
}

export function initialInvariantAccumulator(): InvariantAccumulator {
  const playedDevCards = {} as Record<AnyDevCardId, number>;
  for (const type of DEV_TYPES) playedDevCards[type] = 0;
  return { playedDevCards };
}

function handSize(p: PlayerState): number {
  return RESOURCE_TYPES.reduce((sum, res) => sum + p.resources[res], 0);
}

// ---- I1: bank + Σ hands == 19 per resource ------------------------------------------------------

function checkI1(state: GameState, bankPerResource: number): void {
  for (const res of RESOURCE_TYPES) {
    const total = state.bank[res] + state.players.reduce((sum, p) => sum + p.resources[res], 0);
    if (total !== bankPerResource) {
      throw new InvariantViolationError(
        'I1',
        `${res}: bank(${state.bank[res]}) + hands != ${bankPerResource} (got ${total})`
      );
    }
  }
}

// ---- I2: built + piecesLeft == the per-player supply ------------------------------------------

function checkI2(state: GameState, piecesPerPlayer: Readonly<{ roads: number; settlements: number; cities: number }>): void {
  for (const p of state.players) {
    if (p.roads.length + p.piecesLeft.roads !== piecesPerPlayer.roads) {
      throw new InvariantViolationError(
        'I2',
        `seat ${p.seat} roads: ${p.roads.length} built + ${p.piecesLeft.roads} left != ${piecesPerPlayer.roads}`
      );
    }
    if (p.settlements.length + p.piecesLeft.settlements !== piecesPerPlayer.settlements) {
      throw new InvariantViolationError(
        'I2',
        `seat ${p.seat} settlements: ${p.settlements.length} built + ${p.piecesLeft.settlements} left != ${piecesPerPlayer.settlements}`
      );
    }
    if (p.cities.length + p.piecesLeft.cities !== piecesPerPlayer.cities) {
      throw new InvariantViolationError(
        'I2',
        `seat ${p.seat} cities: ${p.cities.length} built + ${p.piecesLeft.cities} left != ${piecesPerPlayer.cities}`
      );
    }
  }
}

// ---- I3: devDeck + Σ hands + Σ played == 25, composition preserved ----------------------------

const DEV_TYPES_SET: ReadonlySet<string> = new Set(DEV_TYPES);

function updatePlayedDevCards(
  acc: Readonly<Record<AnyDevCardId, number>>,
  events: readonly GameEvent[]
): Record<AnyDevCardId, number> {
  const out = { ...acc };
  for (const e of events) {
    // cardMods combo ids (T-904) aren't `AnyDevCardId` members — see `DEV_TYPES`'s header comment
    // for why they're deliberately excluded from this tally.
    if (e.type === 'devPlayed' && DEV_TYPES_SET.has(e.card)) out[e.card as AnyDevCardId] += 1;
  }
  return out;
}

function checkI3(
  state: GameState,
  devDeckComposition: Readonly<Partial<Record<AnyDevCardId, number>>>,
  playedDevCards: Readonly<Record<AnyDevCardId, number>>
): void {
  const inDeck = {} as Record<AnyDevCardId, number>;
  for (const type of DEV_TYPES) inDeck[type] = 0;
  for (const c of state.devDeck) {
    if (DEV_TYPES_SET.has(c)) inDeck[c] += 1;
  }

  const inHands = {} as Record<AnyDevCardId, number>;
  for (const type of DEV_TYPES) inHands[type] = 0;
  for (const p of state.players) {
    for (const c of p.devCards) {
      if (DEV_TYPES_SET.has(c.type)) inHands[c.type] += 1;
    }
  }

  for (const type of DEV_TYPES) {
    const total = inDeck[type] + inHands[type] + playedDevCards[type];
    const expected = devDeckComposition[type] ?? 0;
    if (total !== expected) {
      throw new InvariantViolationError(
        'I3',
        `${type}: deck(${inDeck[type]}) + hands(${inHands[type]}) + played(${playedDevCards[type]}) != ${expected} (got ${total})`
      );
    }
  }
}

// ---- I4: no negative counts; discard amounts == floor(hand/2) at the 7 ------------------------

function checkI4Negatives(state: GameState): void {
  for (const res of RESOURCE_TYPES) {
    if (state.bank[res] < 0) throw new InvariantViolationError('I4', `bank ${res} is negative: ${state.bank[res]}`);
  }
  for (const p of state.players) {
    for (const res of RESOURCE_TYPES) {
      if (p.resources[res] < 0) {
        throw new InvariantViolationError('I4', `seat ${p.seat} ${res} is negative: ${p.resources[res]}`);
      }
    }
    if (p.piecesLeft.roads < 0 || p.piecesLeft.settlements < 0 || p.piecesLeft.cities < 0) {
      throw new InvariantViolationError('I4', `seat ${p.seat} has a negative piecesLeft count`);
    }
  }
}

function checkI4DiscardAmounts(prev: GameState, next: GameState): void {
  if (next.phase.kind !== 'discard' || prev.phase.kind === 'discard') return; // only at the transition INTO discard
  for (const seat of next.phase.pending) {
    const player = next.players[seat];
    if (!player) throw new Error(`BUG: discard pending seat ${seat} does not exist`);
    const expected = Math.floor(handSize(player) / 2);
    const amount = next.phase.amounts[seat];
    if (amount !== expected) {
      throw new InvariantViolationError(
        'I4',
        `seat ${seat} owed ${amount} but floor(hand ${handSize(player)}/2) = ${expected}`
      );
    }
  }
}

// ---- I5: every settlement/city satisfies the distance rule; every road connects back to the ---
// ---- seat's own network, both re-derived from scratch over the whole board --------------------

function checkI5Distance(state: GameState, geometry: BoardGeometry): void {
  const buildings: { seat: Seat; vertex: VertexId }[] = [];
  for (const p of state.players) {
    for (const v of p.settlements) buildings.push({ seat: p.seat, vertex: v });
    for (const v of p.cities) buildings.push({ seat: p.seat, vertex: v });
    // Explorers & Pirates (T-1107, §EP4.2): a harbor settlement is a real building too — removed
    // from `p.settlements` on upgrade (the piece returns to supply, like a base city upgrade) but
    // still occupying its vertex. `harborSettlementsOf` is `[]` outside a live E&P game (RK-13-safe).
    for (const v of harborSettlementsOf(state, p.seat)) buildings.push({ seat: p.seat, vertex: v });
  }
  const occupied = new Set(buildings.map((b) => b.vertex));
  if (occupied.size !== buildings.length) {
    throw new InvariantViolationError('I5', 'two buildings occupy the same vertex');
  }
  for (const b of buildings) {
    const vert = geometry.vertices[b.vertex];
    if (!vert) throw new Error(`BUG: unknown vertex ${b.vertex}`);
    for (const n of vert.neighbors) {
      if (occupied.has(n)) {
        throw new InvariantViolationError(
          'I5',
          `seat ${b.seat}'s building at vertex ${b.vertex} violates the distance rule via neighbor ${n}`
        );
      }
    }
  }
}

function checkI5Connectivity(state: GameState, geometry: BoardGeometry): void {
  for (const p of state.players) {
    // Rivers (T-1003, §TB3.2): a bridge joins the road network seamlessly (no junction requirement,
    // unlike the seafarers road<->ship switch, S5.2, which I5 deliberately does NOT widen to below —
    // ships have their own connectivity story), so it's folded into the same edge set as `p.roads`
    // here. `bridgesOf` is `[]` outside a rivers game (RK-13-safe).
    const bridges = bridgesOf(state, p.seat);
    const edgeIds = [...p.roads, ...bridges];
    if (edgeIds.length === 0) continue;
    const adjacency = new Map<VertexId, { edge: EdgeId; to: VertexId }[]>();
    const link = (from: VertexId, edge: EdgeId, to: VertexId): void => {
      const list = adjacency.get(from);
      if (list) list.push({ edge, to });
      else adjacency.set(from, [{ edge, to }]);
    };
    for (const edgeId of edgeIds) {
      const e = geometry.edges[edgeId];
      if (!e) throw new Error(`BUG: seat ${p.seat} has a road/bridge on unknown edge ${edgeId}`);
      link(e.a, edgeId, e.b);
      link(e.b, edgeId, e.a);
    }

    // BFS across the seat's own roads+bridges, seeded from every one of their building vertices —
    // any edge never reached is a floating fragment disconnected from the seat's network. Harbor
    // settlements (T-1107, §EP4.2) seed it too — same reasoning as `checkI5Distance` above: an
    // upgrade removes the vertex from `p.settlements` but it's still a real building a road network
    // may anchor to (`harborSettlementsOf` is `[]` outside a live E&P game, RK-13-safe).
    const visitedEdges = new Set<EdgeId>();
    const seenVertices = new Set<VertexId>([
      ...p.settlements,
      ...p.cities,
      ...harborSettlementsOf(state, p.seat),
    ]);
    const queue: VertexId[] = [...seenVertices];
    while (queue.length > 0) {
      const v = queue.shift()!;
      for (const { edge, to } of adjacency.get(v) ?? []) {
        visitedEdges.add(edge);
        if (!seenVertices.has(to)) {
          seenVertices.add(to);
          queue.push(to);
        }
      }
    }
    if (visitedEdges.size !== edgeIds.length) {
      throw new InvariantViolationError(
        'I5',
        `seat ${p.seat} has ${edgeIds.length - visitedEdges.size} road/bridge(s) not connected to any of their buildings`
      );
    }
  }
}

// ---- I6: LR/LA recompute from scratch matches state.awards; longestRoadLength agrees with the --
// ---- structurally-different brute-force cross-check (T-110) -----------------------------------

// `updateAwards` (rules/awards.ts) is only ever invoked by the engine after buildRoad/
// buildSettlement/placeFreeRoad (longest road) or playKnight (largest army) — buildCity moves a
// vertex from settlement to city without touching any road or introducing a new blocking vertex,
// and every other action type touches neither roads, settlements, nor playedKnights at all. So the
// award fields PROVABLY cannot have changed since the last time this check passed for any other
// action type; running the (expensive, brute-force-per-seat) recompute only when it actually could
// have changed is a correctness-preserving optimization, not a weaker check — see sim.test.ts's
// runtime budget note.
const LONGEST_ROAD_RELEVANT: ReadonlySet<Action['type']> = new Set([
  'buildRoad',
  'buildSettlement',
  'placeFreeRoad',
  // Seafarers: a ship build/move can change the Longest Trade Route (which reuses the longestRoad
  // award slot), so re-verify the recompute-vs-state check after them too.
  'buildShip',
  'moveShip',
  // Caravans (T-1004, §TB4.3): a camel placement can double an existing road's weight, changing the
  // Longest Road award without touching `roads`/`settlements` themselves.
  'placeCamel',
]);

function checkI6LongestRoad(state: GameState): void {
  const recomputedLR = updateLongestRoad(state).awards.longestRoad;
  if (recomputedLR.holder !== state.awards.longestRoad.holder || recomputedLR.length !== state.awards.longestRoad.length) {
    throw new InvariantViolationError(
      'I6',
      `longestRoad stale: state has ${JSON.stringify(state.awards.longestRoad)}, recompute gives ${JSON.stringify(recomputedLR)}`
    );
  }
  // The brute-force cross-check is a roads-only, UNWEIGHTED trail search; in a seafarers game the
  // real trail is roads ∪ ships (S6.2), in a rivers game it's roads ∪ bridges (§TB3.2, T-1003), and
  // in a caravans game a camel-carrying road counts DOUBLE (§TB4.3, T-1004), so it would legitimately
  // disagree in all three — skip it there. The recompute-vs-state check above still guards the
  // award, and the dedicated Longest-Trade-Route/rivers/caravans unit tests cross-check the widened
  // length directly.
  if (state.ext?.seafarers || isRiversState(state) || isCaravansState(state)) return;
  for (const p of state.players) {
    const viaAdjacency = longestRoadLength(state, p.seat);
    const viaBruteForce = longestRoadBruteForce(state, p.seat);
    if (viaAdjacency !== viaBruteForce) {
      throw new InvariantViolationError(
        'I6',
        `seat ${p.seat} longest-road length disagreement: adjacency-DFS ${viaAdjacency} vs brute-force ${viaBruteForce}`
      );
    }
  }
}

function checkI6LargestArmy(state: GameState): void {
  const recomputedLA = updateLargestArmy(state).awards.largestArmy;
  if (recomputedLA.holder !== state.awards.largestArmy.holder || recomputedLA.count !== state.awards.largestArmy.count) {
    throw new InvariantViolationError(
      'I6',
      `largestArmy stale: state has ${JSON.stringify(state.awards.largestArmy)}, recompute gives ${JSON.stringify(recomputedLA)}`
    );
  }
}

// ---- I7: recomputed VP matches; winner set iff VP >= targetVp and it was that player's turn ----
//
// R13.2 (docs/01 §R13.2, FAQ #16/#74): "You cannot win on another player's turn even with 10+
// points" — `reduce.ts`'s `checkWin` deliberately only evaluates the ACTIVE player after their own
// action (docs/03 §7's "and it was that player's turn"). A BYSTANDER can transiently sit at ≥10 VP
// without winning: Longest Road's R11.3 full re-evaluation can crown a sole leader who is neither
// the turn owner nor the previous holder (e.g. seat 3 builds a settlement that breaks seat 2's
// 6-road down to 4, and seat 1 — untouched this transition — turns out to already hold the new
// sole-max 5-road and so becomes the new holder, possibly crossing 10 VP on seat 3's turn). This
// check therefore only holds the ACTIVE player to the "already won" bar — checking every seat here
// (an earlier draft did) is a false positive against the documented rule, not an engine bug.

// Fishermen (T-1002, §TB2.5): the Old Boot holder's effective win target is `winTargetFor` (base
// `targetVp` + 1), not the raw config value — using it here (instead of `state.config.targetVp`
// directly) keeps I7 correct for a fishermen game without weakening it for anyone else: outside a
// fishermen game `winTargetFor` is exactly `state.config.targetVp` (RK-13 bit-identical).
function checkI7(state: GameState): void {
  const activeSeat = state.turn.player;
  const activeVp = computeVp(state, activeSeat).total;
  const activeTarget = winTargetFor(state, activeSeat);
  if (state.phase.kind !== 'ended' && activeVp >= activeTarget) {
    throw new InvariantViolationError(
      'I7',
      `active seat ${activeSeat} has ${activeVp} >= target ${activeTarget} but the game hasn't ended (R13.2)`
    );
  }
  if (state.phase.kind === 'ended') {
    // The Wonders of Hexhaven (T-759): completing every wonder stage is an ALTERNATE win that
    // legitimately ends the game with a winner BELOW `targetVp` (vp.ts's `checkWin`), so the
    // "winner reached the VP target" cross-check simply does not apply to a wonder winner — skip it
    // exactly where it doesn't hold (the same "skip the cross-check where it legitimately doesn't
    // apply" precedent the Fog Islands scenario used for I8). Gated strictly on this scenario's
    // completed wonder, so a NORMAL VP winner here (and every winner in base / every other scenario)
    // is still held to `targetVp` — I7 is unweakened everywhere else (RK-13 bit-identical).
    const wonderWinner = isWondersOfHexhavenState(state) && wonderComplete(state, state.phase.winner);
    const vp = computeVp(state, state.phase.winner).total;
    const target = winTargetFor(state, state.phase.winner);
    if (!wonderWinner && vp < target) {
      throw new InvariantViolationError(
        'I7',
        `winner seat ${state.phase.winner} has only ${vp} VP, below target ${target}`
      );
    }
  }
}

// ---- I8: robber on exactly one valid hex; token multiset matches R1.2 -------------------------

function checkI8(state: GameState, geometry: BoardGeometry, tokenSpiral: readonly number[]): void {
  if (!geometry.hexes[state.board.robber]) {
    throw new InvariantViolationError('I8', `robber sits on an invalid hex ${state.board.robber}`);
  }
  // Seafarers: `board.hexes[i].terrain` is a base-terrain proxy (sea/gold → desert); classify against
  // the authoritative `ext.seafarers.hexTerrain` instead. Sea produces nothing and carries no token
  // (S3.1); gold IS numbered (S9.1). A base game has no ext, so this reads the plain terrain.
  const hexTerrain = state.ext?.seafarers?.hexTerrain;
  const tokens: number[] = [];
  state.board.hexes.forEach((hex, i) => {
    const kind = hexTerrain ? hexTerrain[i] : hex.terrain;
    if (kind === 'sea') {
      if (hex.token !== null) throw new InvariantViolationError('I8', `sea hex carries a token ${hex.token}`);
    } else if (kind === 'desert') {
      if (hex.token !== null) throw new InvariantViolationError('I8', `desert hex carries a token ${hex.token}`);
    } else {
      if (hex.token === null) throw new InvariantViolationError('I8', `numbered hex ${String(kind)} has no token`);
      tokens.push(hex.token);
    }
  });
  // Explorers & Pirates (T-1107, §EP5.1): `tokenSpiral` (resolveBoardParams) is only the STATIC
  // home-island multiset at game start — exploration reveals keep ADDING numbered hexes to the
  // board as ships uncover new `'terrain'` fog tiles, so the true expected multiset grows over the
  // game in a way this per-config resolver can't see (it has no `state`). The per-hex checks above
  // (sea/desert carry no token; every other hex does) already caught anything that would actually
  // corrupt a hex's own token — skip the fixed-multiset equality here rather than assert a stale
  // expectation, mirroring `checkI6LongestRoad`'s own "skip the cross-check where it legitimately
  // doesn't apply" precedent for seafarers/rivers/caravans.
  // The Fog Islands (T-756, Seafarers 5-6 scenario) has the EXACT same shape of growth: `tokenSpiral`
  // here is `board.tokens`, the scenario's STATIC starting-island multiset only — it never included
  // the fog tiles at all (they live in `ext.seafarers.fog.stack`, seeded separately, board.ts's
  // `seedScenarioFog`), so a reveal adds a numbered hex the static multiset never accounted for. Same
  // skip, gated on `ext.seafarers.fog` being present (absent for every OTHER seafarers scenario, so
  // their fixed-multiset check is unaffected — RK-13-adjacent for the rest of the seafarers suite).
  if (state.ext?.explorersPirates || state.ext?.seafarers?.fog) return;
  const expected = [...tokenSpiral].sort((a, b) => a - b);
  const actual = tokens.sort((a, b) => a - b);
  if (expected.length !== actual.length || expected.some((v, i) => v !== actual[i])) {
    throw new InvariantViolationError(
      'I8',
      `token multiset mismatch: expected [${expected.join(',')}], got [${actual.join(',')}]`
    );
  }
}

// ---- I9 (per-transition half): stateVersion increments by exactly 1 ---------------------------
// (the replay half — same seed + same actions => identical state — is a whole-game property
// checked periodically by sim/runGame.ts, not here.)

function checkI9(prev: GameState, next: GameState): void {
  if (next.stateVersion !== prev.stateVersion + 1) {
    throw new InvariantViolationError(
      'I9',
      `stateVersion did not increment by exactly 1: ${prev.stateVersion} -> ${next.stateVersion}`
    );
  }
}

// ---- Seafarers ship invariants (T-702): supply conservation, one-piece-per-edge, sea edges -------

function checkSeafarers(state: GameState, geometry: BoardGeometry): void {
  const ext = state.ext?.seafarers;
  if (!ext) return;
  const seenEdge = new Map<EdgeId, Seat>();
  const roadEdges = new Set<EdgeId>();
  for (const p of state.players) for (const r of p.roads) roadEdges.add(r);

  ext.ships.forEach((list, seat) => {
    if (list.length + (ext.shipsLeft[seat] ?? 0) !== SHIPS_PER_PLAYER) {
      throw new InvariantViolationError(
        'I2-ships',
        `seat ${seat} ships: ${list.length} built + ${ext.shipsLeft[seat]} left != ${SHIPS_PER_PLAYER}`
      );
    }
    for (const edge of list) {
      const e = geometry.edges[edge];
      if (!e) throw new InvariantViolationError('I5-ships', `seat ${seat} has a ship on unknown edge ${edge}`);
      if (!e.hexes.some((h) => ext.hexTerrain[h] === 'sea')) {
        throw new InvariantViolationError('I5-ships', `seat ${seat}'s ship on edge ${edge} borders no sea hex (S3.2)`);
      }
      if (seenEdge.has(edge)) {
        throw new InvariantViolationError('I5-ships', `edge ${edge} carries two ships (one piece per edge, S3.3)`);
      }
      if (roadEdges.has(edge)) {
        throw new InvariantViolationError('I5-ships', `edge ${edge} carries both a road and a ship (S3.3)`);
      }
      seenEdge.set(edge, seat as Seat);
    }
  });
}

// ---- Event sanity: every accepted action emits at least one event -----------------------------

function checkEventSanity(events: readonly GameEvent[]): void {
  if (events.length === 0) {
    throw new InvariantViolationError('EVENT_SANITY', 'a successful action emitted zero events');
  }
}

/**
 * Runs I1–I9 plus event sanity against one successful `reduce` transition, threading the running
 * dev-card-play tally I3 needs. Throws `InvariantViolationError` on the first violation found.
 */
export function checkInvariants(
  prev: GameState,
  action: Action,
  next: GameState,
  events: readonly GameEvent[],
  acc: InvariantAccumulator
): InvariantAccumulator {
  // Config-aware resolution (docs/03 §8): base games get the frozen base constants/geometry (so
  // behavior is bit-identical); a fiveSix game gets the 30-hex geometry, 24-card bank, 34-card deck,
  // and 28-token spiral. The engine's own resolvers are the single source of truth here — the
  // invariant suite must cross-check against exactly what the shipped module claims.
  const constants = resolveConstants(next.config);
  const geometry = geometryForState(next);
  const boardParams = resolveBoardParams(next.config);

  checkI1(next, constants.bankPerResource);
  checkI2(next, constants.piecesPerPlayer);
  const playedDevCards = updatePlayedDevCards(acc.playedDevCards, events);
  checkI3(next, constants.devDeck, playedDevCards);
  checkI4Negatives(next);
  checkI4DiscardAmounts(prev, next);
  checkI5Distance(next, geometry);
  checkI5Connectivity(next, geometry);
  if (LONGEST_ROAD_RELEVANT.has(action.type)) checkI6LongestRoad(next);
  if (action.type === 'playKnight') checkI6LargestArmy(next);
  checkI7(next);
  checkI8(next, geometry, boardParams.tokenSpiral);
  checkI9(prev, next);
  checkSeafarers(next, geometry);
  checkEventSanity(events);
  return { playedDevCards };
}
