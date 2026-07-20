// T-410 requirement 2: the determinization sampler — the fairness boundary. `sampleDeterminization`
// takes ONLY a `PlayerView` (docs/02 §6 / redact.ts) and produces a full, hypothetical-but-plausible
// `GameState` the real `reduce`/`legal.ts` can run against: the viewer's own hand rides through
// exact; every opponent's hand SIZE is exact (from the view) but its CONTENTS are drawn uniformly at
// random from the multiset the public information leaves possible; the dev deck's remaining
// composition and order are sampled the same way. Every value that would otherwise be "hidden
// information" is therefore INVENTED by this function, never read from a real GameState — there is
// no real GameState anywhere in scope here, only `view`, so a hidden-info read is a compile error,
// not just a discipline violation (enforced further by determinize.test.ts's Proxy-based runtime
// check).

import { CK_CARD_TRACK, ckDeckCards } from '@hexhaven/shared';
import type {
  CitiesKnightsExt,
  DevCardType,
  GameState,
  ImprovementTrack,
  PlayerState,
  ProgressCardId,
  ResourceType,
} from '@hexhaven/shared';
import { resolveConstants } from '../modules/index.js';
import type { OtherPlayerView, PlayerView, PlayerViewEntry } from '../redact.js';
import { nextRand, shuffle } from '../rng.js';
import type { Rng } from './types.js';

const RESOURCE_TYPES: readonly ResourceType[] = ['brick', 'lumber', 'wool', 'grain', 'ore'];

/** The three dev types whose PLAYED count is genuinely unknowable from a `PlayerView` (unlike
 * knights, whose plays are public via `playedKnights`, and victory points, which R9.8 never lets
 * anyone play at all) — see the composition derivation below. */
const UNTRACKED_PLAYED_TYPES: readonly DevCardType[] = ['roadBuilding', 'yearOfPlenty', 'monopoly'];

function isOwnEntry(entry: PlayerViewEntry, me: PlayerViewEntry['seat']): entry is PlayerState {
  return entry.seat === me;
}

/** Shuffle `pool` and hand out `counts[i]` items to hand `i`, in order — a plain "deal from a
 * shuffled deck" (no replacement), which is exactly what sampling a multiset uniformly means here. */
function dealFromPool<T>(rng: Rng, pool: readonly T[], counts: readonly number[]): { hands: T[][]; rng: Rng } {
  const shuffled = shuffle(rng, pool);
  let idx = 0;
  const hands: T[][] = [];
  for (const n of counts) {
    hands.push(shuffled.array.slice(idx, idx + n));
    idx += n;
  }
  return { hands, rng: shuffled.state };
}

export interface DeterminizationResult {
  state: GameState;
  rng: Rng;
}

function removeOne(pool: ProgressCardId[], card: ProgressCardId): void {
  const idx = pool.indexOf(card);
  if (idx !== -1) pool.splice(idx, 1);
}

/**
 * T-804: reconstruct a plausible-but-invented `ext.citiesKnights` from its REDACTED view, the same
 * fairness discipline as the resource/dev-card sampling above. Public fields (commodities,
 * improvements, knights, walls, defenderVp, barbarian, metropolis, merchant, robberLocked,
 * revealedProgress, alchemistForced) ride through exactly; only `progressHand`/`progressDecks` are
 * genuinely hidden and must be INVENTED, per-track (each deck stays composition-pure, C6.1):
 *   1. Each track's full 18-card pool minus MY exact hand minus any already-revealed Printer/
 *      Constitution copy is what's left to split between that track's deck and every opponent's hand.
 *   2. Deal that track's known deck SIZE (`progressDeckCounts`) out of its pure pool; the leftover is
 *      exactly what's currently sitting in SOME opponent's hand.
 *   3. Pool every track's leftover together (a real hand legitimately mixes tracks) and deal it out
 *      by each opponent's known TOTAL hand size (`progressHandCounts`).
 * Returns `undefined` for a non-C&K view (base/fiveSix/seafarers), so those stay unaffected.
 */
function sampleCitiesKnightsExt(
  view: PlayerView,
  others: readonly OtherPlayerView[],
  rng: Rng
): { ext: CitiesKnightsExt | undefined; rng: Rng } {
  const viewCk = view.ext?.citiesKnights;
  if (!viewCk) return { ext: undefined, rng };
  let r = rng;

  const pools: Record<ImprovementTrack, ProgressCardId[]> = {
    trade: [...ckDeckCards('trade')],
    politics: [...ckDeckCards('politics')],
    science: [...ckDeckCards('science')],
  };
  for (const card of viewCk.ownProgressHand) removeOne(pools[CK_CARD_TRACK[card]], card);
  for (const key of ['printer', 'constitution'] as const) {
    if (viewCk.revealedProgress[key] !== undefined) removeOne(pools[CK_CARD_TRACK[key]], key);
  }

  const progressDecks: CitiesKnightsExt['progressDecks'] = { trade: [], politics: [], science: [] };
  let handPool: ProgressCardId[] = [];
  for (const track of ['trade', 'politics', 'science'] as const) {
    const deal = dealFromPool(r, pools[track], [viewCk.progressDeckCounts[track]]);
    r = deal.rng;
    const dealt = deal.hands[0] ?? [];
    progressDecks[track] = dealt;
    const leftover = [...pools[track]];
    for (const card of dealt) removeOne(leftover, card);
    handPool = handPool.concat(leftover);
  }

  const handDeal = dealFromPool(
    r,
    handPool,
    others.map((o) => viewCk.progressHandCounts[o.seat] ?? 0)
  );
  r = handDeal.rng;

  const progressHand: ProgressCardId[][] = view.players.map((entry) => {
    if (entry.seat === view.me) return [...viewCk.ownProgressHand];
    const idx = others.findIndex((o) => o.seat === entry.seat);
    return idx === -1 ? [] : (handDeal.hands[idx] ?? []);
  });

  const ext: CitiesKnightsExt = {
    commodities: viewCk.commodities.map((c) => ({ ...c })),
    improvements: viewCk.improvements.map((i) => ({ ...i })),
    knights: viewCk.knights.map((list) => list.map((k) => ({ ...k }))),
    walls: viewCk.walls.map((w) => [...w]),
    progressHand,
    defenderVp: [...viewCk.defenderVp],
    barbarian: { ...viewCk.barbarian },
    metropolis: { ...viewCk.metropolis },
    progressDecks,
    merchant: viewCk.merchant ? { ...viewCk.merchant } : null,
    robberLocked: viewCk.robberLocked,
    alchemistForced: viewCk.alchemistForced,
    revealedProgress: { ...viewCk.revealedProgress },
    // Spy peek reveal (redact.ts hidden-info UX fix): a bot never uses the two-step peek (it plays
    // Spy directly via the pre-existing `targetCard`/`targetCardIndex` one-shot path, sim/bot.ts), so
    // there is nothing meaningful to invent here — every seat gets a fresh "no pending peek" slate,
    // mirroring how `view.ext.helpers` (a bot never reconstructs that block at all) is left out below.
    spyPeek: view.players.map(() => null),
  };

  return { ext, rng: r };
}

/**
 * Samples a full `GameState` consistent with `view` (task requirement 2). Every draw threads `rng`;
 * the returned `rng` is advanced past every draw this call made, so repeated calls with the SAME
 * `(view, rng)` are identical (search.ts relies on this for determinism, same contract as the rest
 * of the engine, docs/03 §6).
 */
export function sampleDeterminization(view: PlayerView, rng: Rng): DeterminizationResult {
  let r = rng;

  const meEntry = view.players.find((p) => p.seat === view.me);
  if (!meEntry || !isOwnEntry(meEntry, view.me)) {
    throw new Error(`BUG: sampleDeterminization found no own PlayerView entry for seat ${view.me}`);
  }
  const others = view.players.filter((p): p is OtherPlayerView => p.seat !== view.me);

  // Config-tunable deck sizes (docs/03 §8): the 5–6 extension bumps the bank to 24/resource (X6) and
  // the dev deck to 34 (X7). Reading these off the base globals instead would under-count the
  // opponents' possible cards in a 5–6 game — the resource pool would come out 25 cards short, so
  // `dealFromPool` would run dry and hand a late opponent (e.g. a steal victim) FEWER cards than its
  // exact `resourceCount`, which then surfaces as robber.ts's "victim holds no cards" throw. For a
  // base game `resolveConstants` returns exactly the base values, so this is a no-op there (RK-13).
  const constants = resolveConstants(view.config);
  const bankPerResource = constants.bankPerResource;
  const devDeckSpec = constants.devDeck;
  // `devDeckSpec` is a `Partial` (T-904, modules/types.ts) — the base/fiveSix 5 keys are always
  // present in practice, but a `cardMods`-enabled game also carries its 6 curated additions here
  // (`?? 0` throughout this section keeps the total exact either way). NOTE: the sampling below
  // (`myDevByType`/`untrackedSlots`/`devPool`) only models the base 5 "play" types — cardMods'
  // curated types aren't reconstructed into any opponent's SAMPLED hand yet (a known limitation:
  // AI/bot rollouts don't model cardMods cards; the total below still counts them correctly, so
  // this can only under-, never over-, populate an opponent's invented hand).
  const devDeckTotal = Object.values(devDeckSpec).reduce((sum: number, n) => sum + (n ?? 0), 0);

  // ---- Resource cards (R1): totals per type are fully determined by bank + my exact hand -------
  const resourcePool: ResourceType[] = [];
  for (const res of RESOURCE_TYPES) {
    const remaining = bankPerResource - view.bank[res] - meEntry.resources[res];
    for (let i = 0; i < remaining; i++) resourcePool.push(res);
  }
  const resourceDeal = dealFromPool(
    r,
    resourcePool,
    others.map((o) => o.resourceCount)
  );
  r = resourceDeal.rng;

  // ---- Dev cards: knights and victory points are fully derivable; the other three "play" types
  // are not (no public per-type play counter exists), so how many of EACH of those three has been
  // played is itself sampled, bounded by the total play count the view DOES let us derive exactly
  // (deck size 25 minus everything still held anywhere, R9.1) minus the known knight-play total
  // (every seat's `playedKnights` is public, redact.ts §OtherPlayerView).
  const myDevByType: Record<DevCardType, number> = {
    knight: 0,
    roadBuilding: 0,
    yearOfPlenty: 0,
    monopoly: 0,
    victoryPoint: 0,
  };
  // `meEntry.devCards[].type` is `AnyDevCardId` (T-904) — only the base 5 "play" types are tallied
  // here (see the `devDeckSpec` comment above for why cardMods' curated types aren't modeled yet).
  for (const c of meEntry.devCards) {
    if (c.type in myDevByType) myDevByType[c.type as DevCardType] += 1;
  }

  const totalKnightsPlayedEver = view.players.reduce((sum, p) => sum + p.playedKnights, 0);
  const totalHeldElsewhere = others.reduce((sum, o) => sum + o.devCardCount, 0);
  const totalStillInPlay = view.devDeckCount + totalHeldElsewhere + meEntry.devCards.length;
  const totalPlayedEver = devDeckTotal - totalStillInPlay;
  const playedUntrackedTotal = Math.max(0, totalPlayedEver - totalKnightsPlayedEver);

  const untrackedSlots: DevCardType[] = [];
  for (const type of UNTRACKED_PLAYED_TYPES) {
    const notInMyHand = (devDeckSpec[type] ?? 0) - myDevByType[type];
    for (let i = 0; i < notInMyHand; i++) untrackedSlots.push(type);
  }
  const shuffledSlots = shuffle(r, untrackedSlots);
  r = shuffledSlots.state;
  const cappedPlayed = Math.min(playedUntrackedTotal, shuffledSlots.array.length);
  const stillAvailable = shuffledSlots.array.slice(cappedPlayed);

  const devPool: DevCardType[] = [...stillAvailable];
  const knightRemaining = Math.max(0, (devDeckSpec.knight ?? 0) - myDevByType.knight - totalKnightsPlayedEver);
  for (let i = 0; i < knightRemaining; i++) devPool.push('knight');
  const vpRemaining = Math.max(0, (devDeckSpec.victoryPoint ?? 0) - myDevByType.victoryPoint);
  for (let i = 0; i < vpRemaining; i++) devPool.push('victoryPoint');

  const devDeal = dealFromPool(r, devPool, [view.devDeckCount, ...others.map((o) => o.devCardCount)]);
  r = devDeal.rng;
  const devDeck = devDeal.hands[0] ?? [];
  const otherDevHands = devDeal.hands.slice(1);

  // boughtOnTurn is unknowable for a sampled (not really-held) opponent card; treated as "old"
  // (never this-turn) — the conservative, most-permissive guess, and only ever used inside a
  // ROLLOUT's hypothetical world, never to decide the bot's own play (its own hand is exact).
  const assumedBoughtOnTurn = view.turn.number - 1;

  const players: PlayerState[] = view.players.map((entry) => {
    if (isOwnEntry(entry, view.me)) return { ...entry };
    const idx = others.findIndex((o) => o.seat === entry.seat);
    const resources: Record<ResourceType, number> = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };
    for (const res of resourceDeal.hands[idx] ?? []) resources[res] += 1;
    const devCards = (otherDevHands[idx] ?? []).map((type) => ({ type, boughtOnTurn: assumedBoughtOnTurn }));
    return {
      seat: entry.seat,
      color: entry.color,
      resources,
      devCards,
      playedKnights: entry.playedKnights,
      piecesLeft: { ...entry.piecesLeft },
      roads: [...entry.roads],
      settlements: [...entry.settlements],
      cities: [...entry.cities],
    };
  });

  // T-804: sample ext.citiesKnights's hidden progress-hand/deck contents (see the function above);
  // undefined for a non-C&K view, so base/fiveSix/seafarers are unaffected.
  const ckSample = sampleCitiesKnightsExt(view, others, r);
  r = ckSample.rng;

  // `state.rng` drives every future dice roll / steal draw the search's rollouts make. There is no
  // real hidden value to read here (redact() never carries `rng` — see redact.ts) — it is sampled
  // fresh from the bot's OWN rng stream, same as every other hidden field above.
  const rngDraw = nextRand(r);
  r = rngDraw.state;
  const sampledRng = Math.floor(rngDraw.value * 4294967296) >>> 0;

  // Carry expansion state (e.g. the 5–6 Paired-Players partial-turn marker) so the bot's candidate
  // enumeration sees the SAME restrictions the real engine will enforce — without this the bot
  // reasons as if it were a normal `main` turn and proposes illegal player-trades, which the server
  // rejects (WRONG_PHASE) and the drive can't recover from (playtest hang, BUGS.md B-19). `fiveSix`/
  // `seafarers` are fully public so they ride through the view unchanged; `citiesKnights` is the
  // sampled reconstruction above (its view shape differs from the real ext, C6.1/C6.3 hidden info).
  const ext: GameState['ext'] =
    view.ext?.fiveSix || view.ext?.seafarers || ckSample.ext
      ? {
          ...(view.ext?.fiveSix ? { fiveSix: view.ext.fiveSix } : {}),
          ...(view.ext?.seafarers
            ? {
                seafarers: {
                  ships: view.ext.seafarers.ships,
                  shipsLeft: view.ext.seafarers.shipsLeft,
                  hexTerrain: view.ext.seafarers.hexTerrain,
                  movedShipOnTurn: view.ext.seafarers.movedShipOnTurn,
                  builtShips: view.ext.seafarers.builtShips,
                  pirate: view.ext.seafarers.pirate,
                  islandChits: view.ext.seafarers.islandChits,
                  // T-756 (Fog Islands): the view's `fog.hidden` is public but the real `fog.stack`
                  // (hidden draw pile) is never carried by `redact.ts` (the cheat-proof boundary) —
                  // same "no real hidden value to read here" doctrine as `sampledRng` above. An empty
                  // stack is a safe INVENTED placeholder (never a read of real hidden data): a
                  // rollout ship move touching a still-fog hex just finds nothing to draw
                  // (`revealFogAt`'s defensive no-op), never fabricating a fake terrain the bot could
                  // exploit. Absent entirely for every other seafarers game (no `fog` in the view).
                  ...(view.ext.seafarers.fog
                    ? { fog: { hidden: view.ext.seafarers.fog.hidden, stack: [] } }
                    : {}),
                },
              }
            : {}),
          ...(ckSample.ext ? { citiesKnights: ckSample.ext } : {}),
        }
      : undefined;

  const state: GameState = {
    v: 1,
    config: view.config,
    rng: sampledRng,
    board: view.board,
    bank: view.bank,
    devDeck,
    players,
    turn: view.turn,
    phase: view.phase,
    awards: view.awards,
    trade: view.trade,
    ext,
    stateVersion: view.stateVersion,
  };

  return { state, rng: r };
}
