// Cities & Knights as a RuleModule (docs/10 §3, docs/rules/cities-knights-rules.md).
//
// T-801 laid the DATA-MODEL foundation (shared types/constants + this module's dormant skeleton +
// ext-state helpers, state.ts). T-802 activates it (C1, C3, C4, C12):
//   • `modules/index.ts` `resolveModules` now pushes this module when `config.expansions.
//     citiesKnights` is set (no longer `EXPANSION_NOT_AVAILABLE`), and `createGame.ts` seeds
//     `state.ext.citiesKnights` + resolves `targetVp` to 13 (C1.1) via this module's `constants`.
//   • Commodity production (C3.3, commodities.ts) hooks in via `phaseHooks.afterAction` below — see
//     the seam note there — rather than editing the base `rules/production.ts` inline.
//   • `buildImprovement`/`commodityBankTrade` (improvements.ts) are new `Action` variants, routed
//     through `interceptAction` below exactly like Seafarers routes `buildShip`/`moveShip`.
//   • Metropolis VP (C4.6) feeds `vp.ts`'s `computeVp` via the `citiesKnightsExt` accessor,
//     module-aware (0 for a non-C&K game).
// T-803 added knights/barbarians/the robber lock (barbarian.ts/knights.ts), hooked into the same
// `handleRollDice` roll seam below. T-804 adds progress cards (C6, progressCards.ts): the C6.2 draw
// mechanic is wired into `handleRollDice`'s colour-gate branch (where `progressGateOpened` already
// fires); the Alchemist pre-roll dice override is resolved at the TOP of `handleRollDice` (see
// `applyAlchemistOverride`); `playProgressCard`/`buildCityWall` are new actions routed through
// `citiesKnightsIntercept` below; C11 (no dev cards, no Largest Army in C&K) is enforced by
// rejecting every base dev-card action here (Largest Army's VP exclusion lives in vp.ts).
//
// C&K stays HIDDEN from users at M8: `apps/client/src/options/OptionsPanel.tsx`'s
// `SHIPPED_EXPANSIONS.citiesKnights` stays `false` and the lobby independently rejects it
// (`apps/server/src/lobby.ts` `expansionUnavailable`) — this task only makes the ENGINE able to
// run a C&K game when a config constructs one directly (tests, later T-806 UI).
//
// Base + fiveSix + seafarers stay bit-identical: with citiesKnights off this module is never in
// `activeModules`, so no hook runs (RK-13 + the 5–6 / seafarers sims/oracle).

import { CK_BARBARIAN_STEPS_TO_ATTACK, CK_TARGET_VP, DISCARD_THRESHOLD } from '@hexhaven/shared';
import type { Action, CitiesKnightsExt, EngineErrorCode, GameEvent, GameState, Phase, Seat } from '@hexhaven/shared';
import {
  aqueductGranted,
  barbarianAdvanced,
  barbarianAttackResolved,
  commodityProduction,
  diceRolled,
  discardRequired,
  eventDieRolled,
  production,
  progressGateOpened,
} from '../../events.js';
import type { EngineResult } from '../../reduce.js';
import { resolveConstants } from '../index.js';
import type { RuleModule } from '../types.js';
import { resolveBarbarianAttack, rollEventDie } from './barbarian.js';
import { applyAqueduct, computeCkProduction } from './commodities.js';
import { buildImprovement, canDrawProgress, commodityBankTrade } from './improvements.js';
import { activateKnight, anyKnightAt, buildKnight, chaseRobber, knightDisplace, moveKnight, promoteKnight } from './knights.js';
import { peekSpyTarget, playProgressCard, resolveProgressDraw } from './progressCards.js';
import { citiesKnightsExt, isCitiesKnightsState } from './state.js';
import { buildCityWall } from './walls.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

/**
 * Production-roll seam (docs/10 §3): the base `preRoll` handler (`phases/roll.ts`) has no
 * expansion seam mid-computation — it computes + applies R5 production and emits `production` in
 * one pass. Rather than thread a C&K special case into that base file (forbidden — expansion
 * readiness, docs/10 §3), this hook fully RECOMPUTES the roll's production from scratch under C&K
 * rules (`computeCkProduction`, commodities.ts) using `prev` (the state BEFORE the base handler
 * ran — the exact same players/bank snapshot the base engine's own `computeProduction` read from),
 * then REPLACES `next.players`/`next.bank` with the correct result (a city on forest/pasture/
 * mountains yields 1 resource + 1 commodity, C3.3, not the base's "2 resources"). The stale base
 * `production` event is swapped for a corrected one; a new `commodityProduction` event carries the
 * commodity side; Science-L3 Aqueduct (C4.5) is applied on top before the state is returned.
 */
function handleProductionRoll(
  prev: GameState,
  next: GameState,
  events: readonly GameEvent[]
): { state: GameState; events: GameEvent[] } | null {
  const roll = next.turn.roll;
  if (!roll) return null;
  const total = roll[0] + roll[1];
  if (total === 7) return null; // R6.1: no production on a 7 — base already routed to discard/robber

  const ck = citiesKnightsExt(prev);
  if (!ck) return null;

  const result = computeCkProduction(prev, total, ck);

  const bank = { ...prev.bank };
  let players = prev.players.map((p) => {
    const gain = result.resourceGains.find((g) => g.seat === p.seat);
    if (!gain) return p;
    const resources = { ...p.resources };
    for (const [res, amt] of Object.entries(gain.resources)) {
      const key = res as keyof typeof resources;
      const value = amt ?? 0;
      resources[key] += value;
      bank[key] -= value;
    }
    return { ...p, resources };
  });

  const commodities = ck.commodities.map((c, seat) => {
    const gain = result.commodityGains.find((g) => g.seat === (seat as Seat));
    if (!gain) return c;
    const updated = { ...c };
    for (const [com, amt] of Object.entries(gain.commodities)) {
      const key = com as keyof typeof updated;
      updated[key] += amt ?? 0;
    }
    return updated;
  });

  // C4.5 Aqueduct: applied after resource/commodity gains, on the same bank snapshot.
  const aqueduct = applyAqueduct(players, bank, ck.improvements, result);
  players = aqueduct.players;
  const finalBank = aqueduct.bank;

  const nextState: GameState = {
    ...next,
    players,
    bank: finalBank,
    ext: { ...next.ext, citiesKnights: { ...ck, commodities } },
  };

  // Replace the base (C&K-incorrect) `production` event with the corrected one; add the new
  // commodity/aqueduct events. Every other event from the base handler (`diceRolled`, …) passes
  // through unchanged.
  const correctedEvents = events.map((e) =>
    e.type === 'production' ? production(result.resourceGains, result.resourceShortages) : e
  );
  const newEvents: GameEvent[] = [
    ...correctedEvents,
    commodityProduction(result.commodityGains, result.commodityShortages),
    ...aqueduct.grants.map((g) => aqueductGranted(g.seat, g.resource)),
  ];

  return { state: nextState, events: newEvents };
}

/** A full Seat-keyed record (the `discard` Phase's `amounts` type needs every seat present) —
 *  copied from `phases/roll.ts`'s private helper since Alchemist's override reruns that same
 *  discard-owed computation from scratch (see `applyAlchemistOverride`). */
function zeroSeatAmounts(): Record<Seat, number> {
  return { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
}

function handSize(p: GameState['players'][number]): number {
  return p.resources.brick + p.resources.lumber + p.resources.wool + p.resources.grain + p.resources.ore;
}

/**
 * C6.5 Alchemist: "before rolling, you choose the values of the yellow & red number dice this
 * turn." The base `rollHandler` (phases/roll.ts) has no seam to accept forced dice, so it already
 * ran its OWN random roll by the time this hook sees `next` — if the acting seat has a pending
 * `ck.alchemistForced` override, that random outcome is discarded entirely and the discard/robber
 * routing is recomputed from `prev` (the untouched pre-roll snapshot) using the FORCED total
 * instead, exactly the way `handleProductionRoll` already discards/replaces the base handler's
 * (base-incorrect, for C&K) production. `next.rng` (already advanced by the base handler's two
 * random draws) is kept as-is — that entropy is simply unused this turn, same discipline the event
 * die below already applies. The event die itself is UNAFFECTED ("event die still random", C6.5).
 * Returns the input `next`/`events`/`ck` unchanged when no override is pending.
 */
function applyAlchemistOverride(
  prev: GameState,
  next: GameState,
  events: readonly GameEvent[],
  ck: CitiesKnightsExt
): { next: GameState; events: GameEvent[]; ck: CitiesKnightsExt } {
  const forced = ck.alchemistForced;
  if (!forced) return { next, events: [...events], ck };

  const clearedCk: CitiesKnightsExt = { ...ck, alchemistForced: null };
  const total = forced[0] + forced[1];
  const seat = prev.turn.player;
  // T-906 (docs/07 D-034 `customConstants.discardHandLimit`): the SAME resolved base limit
  // `phases/roll.ts` reads — absent falls back to the literal `DISCARD_THRESHOLD` (RK-13).
  const handLimit = resolveConstants(prev.config).discardHandLimit ?? DISCARD_THRESHOLD;

  if (total === 7) {
    const amounts = zeroSeatAmounts();
    const pending: Seat[] = [];
    for (const p of prev.players) {
      const hand = handSize(p);
      if (hand > handLimit) {
        amounts[p.seat] = Math.floor(hand / 2);
        pending.push(p.seat);
      }
    }
    const phase: Phase =
      pending.length > 0 ? { kind: 'discard', pending, amounts } : { kind: 'moveRobber', returnTo: 'main' };
    const forcedEvents: GameEvent[] = [diceRolled(seat, forced)];
    if (pending.length > 0) {
      forcedEvents.push(discardRequired(pending.map((s) => ({ seat: s, amount: amounts[s] }))));
    }
    return {
      next: { ...prev, rng: next.rng, turn: { ...prev.turn, rolled: true, roll: forced }, phase },
      events: forcedEvents,
      ck: clearedCk,
    };
  }

  return {
    next: { ...prev, rng: next.rng, turn: { ...prev.turn, rolled: true, roll: forced }, phase: { kind: 'main' } },
    events: [diceRolled(seat, forced)],
    ck: clearedCk,
  };
}

/**
 * The 3rd (event) die + barbarian/robber-lock seam (T-803, C5/C8/C10). The base `rollHandler`
 * already drew the two number dice into `next.rng`/`next.turn.roll` and either landed in `main`
 * (production, R5) or `discard`/`moveRobber` (a rolled 7, R6.1) — this hook draws the event die
 * from `next.rng` (a 3rd, C&K-only draw; never touched for a base/fiveSix/seafarers game, RK-13),
 * resolves it (C5.2: ALWAYS, even on a 7 — the barbarian ship doesn't care about the number total),
 * THEN recomputes production (`handleProductionRoll`) from a players snapshot that already reflects
 * any barbarian pillage from THIS roll (C5.2 orders the event die strictly before production, so a
 * city pillaged this instant no longer produces as one). Finally, while the robber is still locked
 * (C10.1) a rolled 7 must never reach the `moveRobber` sub-phase — if nobody owed a discard the base
 * handler already landed there, so it's redirected straight to `main` here; the discard-pending case
 * is handled by the sibling `discard` branch in `phaseHooks.afterAction` below, once the LAST
 * pending discard would otherwise transition into `moveRobber`. T-804: a colour-gate face ALSO
 * resolves the C6.2 progress-card draw here (via `resolveProgressDraw`) — see the Alchemist override
 * above for the one case where `next`/`events` are replaced before any of this runs.
 */
function handleRollDice(
  prev: GameState,
  next: GameState,
  events: readonly GameEvent[],
  actingSeat: Seat
): { state: GameState; events: GameEvent[] } | null {
  const ck0 = citiesKnightsExt(prev);
  if (!ck0) return null;

  const override = applyAlchemistOverride(prev, next, events, ck0);
  const ck = override.ck;
  next = override.next;
  events = override.events;
  const roll = next.turn.roll;

  const draw = rollEventDie(next.rng);
  const dieEvents: GameEvent[] = [eventDieRolled(actingSeat, draw.face)];

  let players = prev.players;
  let barbarian = ck.barbarian;
  let walls = ck.walls;
  let defenderVp = ck.defenderVp;
  let knights = ck.knights;
  let robberLocked = ck.robberLocked;
  let progressDecks = ck.progressDecks;
  let progressHand = ck.progressHand;
  let revealedProgress = ck.revealedProgress;

  if (draw.face === 'ship') {
    // C8.1: one step closer per ship face.
    const position = barbarian.position + 1;
    if (position >= CK_BARBARIAN_STEPS_TO_ATTACK) {
      // C8.2-C8.6: resolve the attack from the CURRENT (pre-this-roll) players/knights/metropolis.
      const attack = resolveBarbarianAttack(players, ck);
      players = attack.players;
      walls = attack.walls;
      if (attack.defenderSeat !== null) {
        defenderVp = defenderVp.map((v, i) => (i === attack.defenderSeat ? v + 1 : v));
      }
      // C8.7: reset the ship + deactivate EVERY knight regardless of the outcome.
      knights = knights.map((list) => list.map((k) => ({ ...k, active: false })));
      barbarian = { position: 0, attacksResolved: barbarian.attacksResolved + 1 };
      robberLocked = false; // C10.1: unlocked by the first (and every subsequent) attack
      dieEvents.push(
        barbarianAttackResolved(
          attack.attackStrength,
          attack.defenseStrength,
          attack.result,
          attack.defenderSeat,
          attack.tiedSeats,
          attack.pillaged
        )
      );
    } else {
      barbarian = { ...barbarian, position };
      dieEvents.push(barbarianAdvanced(position));
    }
  } else if (roll) {
    // C6.2: a colour-gate face — record the track + this roll's red die (by convention, index 1 of
    // the number-die pair), then resolve the actual draw (T-804) in turn order starting with the
    // acting seat.
    dieEvents.push(progressGateOpened(draw.face, roll[1]));
    const drawResult = resolveProgressDraw(prev, draw.face, roll[1], actingSeat);
    progressDecks = drawResult.progressDecks;
    progressHand = drawResult.progressHand;
    revealedProgress = drawResult.revealedProgress;
    dieEvents.push(...drawResult.events);
  }

  const ckAfter: CitiesKnightsExt = {
    ...ck,
    barbarian,
    walls,
    defenderVp,
    knights,
    robberLocked,
    progressDecks,
    progressHand,
    revealedProgress,
  };
  const prevForProduction: GameState = {
    ...prev,
    rng: draw.state,
    players,
    ext: { ...prev.ext, citiesKnights: ckAfter },
  };

  let finalState: GameState = {
    ...next,
    rng: draw.state,
    players,
    ext: { ...next.ext, citiesKnights: ckAfter },
  };
  let finalEvents: GameEvent[] = [...events, ...dieEvents];

  const total = roll ? roll[0] + roll[1] : null;
  if (roll && total !== 7) {
    const prod = handleProductionRoll(prevForProduction, finalState, finalEvents);
    if (prod) {
      finalState = prod.state;
      finalEvents = prod.events;
    }
  }

  // C10.1: while still locked, a rolled 7 owes discard-over-limit (already computed by the base
  // handler above) but must never reach the robber. When nobody owed a discard the base handler
  // already landed in `moveRobber` — redirect straight to `main`.
  if (total === 7 && finalState.phase.kind === 'moveRobber' && ckAfter.robberLocked) {
    finalState = { ...finalState, phase: { kind: 'main' } };
  }

  return { state: finalState, events: finalEvents };
}

/** Pre-routing interception (docs/10 §3): fully handles every new C&K action, all only ever legal
 *  in a C&K game's `main` phase (mirrors how base build actions are main-phase-only). */
function citiesKnightsIntercept(state: GameState, seat: Seat, action: Action): EngineResult | null {
  if (!isCitiesKnightsState(state)) return null;
  const mainOnly = (name: string): EngineResult =>
    fail('WRONG_PHASE', `${name} is only legal in the main phase`);
  switch (action.type) {
    // C7.1: a knight occupies its intersection like a building — no player may build a settlement on
    // a vertex already held by ANY player's knight. Base `buildSettlement` is knight-unaware (knights
    // live in ext.citiesKnights), so enforce it here; a knight never coexists with a setup settlement
    // (knights are built only in main play, after setup), so only the main-phase build needs guarding.
    // Returns null (defer to the base handler) when no knight is there. (BUGS.md B-31.)
    case 'buildSettlement': {
      const ckKnight = citiesKnightsExt(state);
      return ckKnight && anyKnightAt(ckKnight, action.vertex)
        ? fail('OCCUPIED', 'a knight occupies that intersection — you cannot build there (C7.1)')
        : null;
    }
    case 'buildImprovement':
      return state.phase.kind === 'main' ? buildImprovement(state, seat, action.track) : mainOnly('buildImprovement');
    case 'commodityBankTrade':
      return state.phase.kind === 'main'
        ? commodityBankTrade(state, seat, action.give, action.receive)
        : mainOnly('commodityBankTrade');
    case 'buildKnight':
      return state.phase.kind === 'main' ? buildKnight(state, seat, action.vertex) : mainOnly('buildKnight');
    case 'activateKnight':
      return state.phase.kind === 'main' ? activateKnight(state, seat, action.vertex) : mainOnly('activateKnight');
    case 'promoteKnight':
      return state.phase.kind === 'main' ? promoteKnight(state, seat, action.vertex) : mainOnly('promoteKnight');
    case 'moveKnight':
      return state.phase.kind === 'main'
        ? moveKnight(state, seat, action.from, action.to)
        : mainOnly('moveKnight');
    case 'knightDisplace':
      return state.phase.kind === 'main'
        ? knightDisplace(state, seat, action.from, action.to)
        : mainOnly('knightDisplace');
    case 'chaseRobber':
      return state.phase.kind === 'main'
        ? chaseRobber(state, seat, action.knightVertex, action.toHex, action.stealFrom)
        : mainOnly('chaseRobber');
    // T-804 (C9.1/C6.5): a direct city-wall build, main phase only (Engineer builds one free via
    // `playProgressCard` instead, handled by that case below).
    case 'buildCityWall':
      return state.phase.kind === 'main' ? buildCityWall(state, seat, action.vertex, false) : mainOnly('buildCityWall');
    // T-804 (C6.4): every progress card is playable only AFTER rolling in the main phase, EXCEPT
    // Alchemist, which must be played BEFORE rolling (still in `preRoll`, not yet rolled this turn).
    case 'playProgressCard': {
      if (action.card === 'alchemist') {
        return state.phase.kind === 'preRoll' && !state.turn.rolled
          ? playProgressCard(state, seat, action)
          : fail('WRONG_PHASE', 'Alchemist must be played before rolling this turn (C6.4/C6.5)');
      }
      return state.phase.kind === 'main' ? playProgressCard(state, seat, action) : mainOnly('playProgressCard');
    }
    // Spy peek reveal (redact.ts hidden-info UX fix): the "begin" half of a two-step Spy play, gated
    // exactly like a normal card play (main phase, after rolling — C6.4) since it requires holding
    // the card just like `playProgressCard` does.
    case 'peekSpyTarget':
      return state.phase.kind === 'main'
        ? peekSpyTarget(state, seat, action.targetSeat)
        : mainOnly('peekSpyTarget');
    // C11.1: Cities & Knights replaces the base development-card deck entirely with progress cards
    // (C6) — every base dev-card action is rejected outright (module-aware; a base/fiveSix/seafarers
    // game is completely unaffected since this module is never active there, RK-13). Rejecting
    // `playKnight` here also means `playedKnights` can never rise in a C&K game, so Largest Army
    // (C11.2) naturally never has a holder — `vp.ts`'s `computeVp` additionally excludes it
    // explicitly for belt-and-suspenders module-awareness.
    case 'buyDevCard':
    case 'playKnight':
    case 'playRoadBuilding':
    case 'playYearOfPlenty':
    case 'playMonopoly':
      return fail(
        'DEV_CARDS_DISABLED',
        `${action.type} is disabled in Cities & Knights — progress cards replace the dev deck (C11.1)`
      );
    // Defensive (C10.1/C10.2): in normal play the module never lets the engine land in `moveRobber`
    // while locked (see `handleRollDice`/the sibling `discard` hook below), so these are unreachable
    // from real play — guards directly against any other path reaching the robber while locked.
    case 'moveRobber':
    case 'steal': {
      const ck = citiesKnightsExt(state);
      return ck?.robberLocked
        ? fail('ROBBER_LOCKED', 'the robber is locked until the first barbarian attack (C10.1)')
        : null;
    }
    default:
      return null;
  }
}

/** The Cities & Knights module (T-802 city improvements; T-803 knights/barbarians/robber lock). */
export const citiesKnightsModule: RuleModule = {
  id: 'citiesKnights',
  // C1.1: 13 VP overrides the config target, resolved generically (docs/03 §8) rather than a
  // seafarers-style inline createGame check — see createGame.ts.
  constants: { targetVp: CK_TARGET_VP },
  interceptAction: citiesKnightsIntercept,
  phaseHooks: {
    afterAction(prev, next, action, events, actingSeat) {
      if (!isCitiesKnightsState(next)) return null;

      // Peek reveal hygiene (redact.ts hidden-info UX fix): a pending Spy target-hand peek never
      // outlives the turn it was requested on — clear every seat's pending peek the moment the turn
      // advances, so a stale peek can't linger into a future turn's redaction.
      let working = next;
      let touched = false;
      if (next.turn.number !== prev.turn.number) {
        const ck = citiesKnightsExt(working)!;
        if (ck.spyPeek.some((p) => p !== null)) {
          working = {
            ...working,
            ext: { ...working.ext, citiesKnights: { ...ck, spyPeek: ck.spyPeek.map(() => null) } },
          };
          touched = true;
        }
      }

      if (action.type === 'rollDice') {
        const rolled = handleRollDice(prev, working, events, actingSeat);
        if (rolled) return rolled;
        return touched ? { state: working, events: [...events] } : null;
      }
      // C10.1: the LAST pending discard's resolution is the other path into `moveRobber` (the
      // rollDice hook above only catches the "nobody owed a discard" path) — redirect it the same
      // way, straight to `main`, while the robber is still locked.
      if (action.type === 'discard' && working.phase.kind === 'moveRobber') {
        const ck = citiesKnightsExt(working);
        if (ck?.robberLocked) {
          return { state: { ...working, phase: { kind: 'main' } }, events: [...events] };
        }
      }
      return touched ? { state: working, events: [...events] } : null;
    },
  },
};

export { canDrawProgress };
export { computeCkProduction } from './commodities.js';
export type { CkProductionResult } from './commodities.js';
export { buildImprovement, commodityBankTrade, TRACK_COMMODITY } from './improvements.js';
export { citiesKnightsExt, commoditiesOf, initCitiesKnightsExt, isCitiesKnightsState } from './state.js';
export { resolveBarbarianAttack, rollEventDie } from './barbarian.js';
export type { BarbarianAttackResult } from './barbarian.js';
export {
  activateKnight,
  anyKnightAt,
  buildKnight,
  chaseRobber,
  chaseRobberHexTargets,
  chaseRobberKnights,
  displaceableKnights,
  findKnight,
  intrigueTargets,
  knightDisplace,
  knightDisplaceTargets,
  knightMoveTargets,
  knightPlacementVertices,
  legalKnightVertices,
  movableKnights,
  moveKnight,
  promoteKnight,
} from './knights.js';
export { diplomatOpenRoads, merchantHexes, peekSpyTarget, playProgressCard, resolveProgressDraw } from './progressCards.js';
export { buildCityWall, wallEligibleCities } from './walls.js';
