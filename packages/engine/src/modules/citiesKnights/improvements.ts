// Cities & Knights city improvements (T-802, docs/rules/cities-knights-rules.md C4) + the
// Trade-L3 Trading House commodity bank trade (C4.5) + the C4.4 progress-card draw-eligibility
// helper (consumed by T-804, not implemented here).
//
// Simplification note (documented per the task's "note anything ambiguous" instruction): C4.3
// gates advancing PAST level 3 on "a city that could still receive a metropolis". The data model
// (T-801, `CitiesKnightsExt.metropolis: Record<ImprovementTrack, Seat | null>`) tracks metropolis
// OWNERSHIP per track, not which specific vertex holds the piece — so there is no way to ask "is
// this particular city already somebody else's metropolis". Given that, "metropolis-eligible" here
// reduces to the same gate C4.3 already requires at every level: own >= 1 city. This is exact for
// the common case (a player never owns more metropolises than cities) and is flagged here rather
// than silently assumed; a vertex-precise model can tighten this in a later task if needed.

import { CK_COMMODITY_SUPPLY, ckCardDrawEligible, ckImprovementCost } from '@hexhaven/shared';
import type { Commodity, EngineErrorCode, GameEvent, GameState, ImprovementTrack, ResourceType, Seat } from '@hexhaven/shared';
import type { EngineResult } from '../../reduce.js';
import { commodityTraded, improvementBuilt, metropolisCaptured, metropolisPlaced } from '../../events.js';
import { citiesKnightsExt } from './state.js';

function fail(code: EngineErrorCode, message: string): EngineResult {
  return { ok: false, error: { code, message } };
}

/** C4.1: which commodity buys which track. */
export const TRACK_COMMODITY: Readonly<Record<ImprovementTrack, Commodity>> = {
  trade: 'cloth',
  politics: 'coin',
  science: 'paper',
};

/**
 * C4.2/C4.3/C4.6: advance `track` by exactly one level, paying `ckImprovementCost(nextLevel)`
 * units of the track's commodity to the bank. Requires owning >= 1 city (C4.3, see the
 * metropolis-eligibility simplification note above — applied uniformly across all 5 levels).
 * Placing/capturing a metropolis (C4.6) is folded in here since it's a direct, mechanical
 * consequence of reaching level 4/5, not a separate player decision.
 *
 * `discount` (T-804, Crane C6.5: "build a city improvement for 1 fewer commodity") shaves that many
 * units off the cost, floored at 1 (a track's own level cost is never free). Defaults to 0 for the
 * plain `buildImprovement` action, so base callers are unaffected.
 */
export function buildImprovement(
  state: GameState,
  seat: Seat,
  track: ImprovementTrack,
  discount = 0
): EngineResult {
  const ck = citiesKnightsExt(state);
  if (!ck) return fail('WRONG_PHASE', 'buildImprovement is only legal in a Cities & Knights game');

  const player = state.players[seat]!;
  if (player.cities.length === 0) {
    return fail('NO_CITY_OWNED', `seat ${seat} must own at least one city to buy a city improvement (C4.3)`);
  }

  const currentLevel = ck.improvements[seat]![track];
  if (currentLevel >= 5) return fail('IMPROVEMENT_MAX_LEVEL', `${track} is already at level 5 (C4.1)`);

  const nextLevel = currentLevel + 1;
  const cost = Math.max(1, ckImprovementCost(nextLevel as 1 | 2 | 3 | 4 | 5) - discount);
  const commodity = TRACK_COMMODITY[track];
  const held = ck.commodities[seat]![commodity];
  if (held < cost) {
    return fail(
      'CANT_AFFORD',
      `${track} level ${nextLevel} costs ${cost} ${commodity}, seat ${seat} holds ${held} (C4.2)`
    );
  }

  const commodities = ck.commodities.map((c, i) => (i === seat ? { ...c, [commodity]: c[commodity] - cost } : c));
  const improvements = ck.improvements.map((imp, i) => (i === seat ? { ...imp, [track]: nextLevel } : imp));

  let metropolis = ck.metropolis;
  const events: GameEvent[] = [improvementBuilt(seat, track, nextLevel)];

  if (nextLevel === 4 && ck.metropolis[track] === null) {
    // C4.6: first to reach level 4 places the track's (only) metropolis.
    metropolis = { ...metropolis, [track]: seat };
    events.push(metropolisPlaced(seat, track));
  } else if (nextLevel === 5 && ck.metropolis[track] !== null && ck.metropolis[track] !== seat) {
    // C4.6: reaching level 5 captures the metropolis from a holder STILL at level 4 — a holder
    // already at level 5 is safe. `holder`'s own improvement level is untouched by this action.
    const holder = ck.metropolis[track]!;
    if (improvements[holder]![track] === 4) {
      metropolis = { ...metropolis, [track]: seat };
      events.push(metropolisCaptured(holder, seat, track));
    }
  }

  const nextState: GameState = {
    ...state,
    ext: { ...state.ext, citiesKnights: { ...ck, commodities, improvements, metropolis } },
  };
  return { ok: true, state: nextState, events };
}

function isCommodity(v: ResourceType | Commodity): v is Commodity {
  return v === 'paper' || v === 'cloth' || v === 'coin';
}

/**
 * C4.5 Trade-L3 Trading House: trade a commodity for any resource/commodity at 2:1 with Trading
 * House (trade improvement >= 3), else the base 4:1 (commodities have no harbor concept). Mirrors
 * `phases/main.ts`'s `bankTrade` shape/validation, but reading/writing the C&K commodity holdings
 * (which live outside `state.bank`/`player.resources` — the 12-per-commodity supply, C3.1, is
 * derived, not stored, so "paying to the bank" is just decrementing the seat's own holding).
 */
export function commodityBankTrade(
  state: GameState,
  seat: Seat,
  give: Commodity,
  receive: ResourceType | Commodity
): EngineResult {
  if ((give as string) === (receive as string)) return fail('BAD_TRADE', 'give and receive must be different (C4.5)');

  const ck = citiesKnightsExt(state);
  if (!ck) return fail('WRONG_PHASE', 'commodityBankTrade is only legal in a Cities & Knights game');

  const rate: 2 | 4 = ck.improvements[seat]!.trade >= 3 ? 2 : 4; // C4.5 Trading House
  const held = ck.commodities[seat]![give];
  if (held < rate) {
    return fail('CANT_AFFORD', `trading ${give} needs ${rate} at this rate, seat ${seat} holds ${held}`);
  }

  const receiveIsCommodity = isCommodity(receive);
  if (receiveIsCommodity) {
    const total = ck.commodities.reduce((sum, c) => sum + c[receive], 0);
    if (total >= CK_COMMODITY_SUPPLY) return fail('BANK_EMPTY', `no ${receive} left in the supply (C3.1)`);
  } else if (state.bank[receive] < 1) {
    return fail('BANK_EMPTY', `the bank has no ${receive} left`);
  }

  const commodities = ck.commodities.map((c, i) => {
    if (i !== seat) return c;
    const updated = { ...c, [give]: c[give] - rate };
    if (receiveIsCommodity) updated[receive] = updated[receive] + 1;
    return updated;
  });

  const bank = { ...state.bank };
  let players = state.players;
  if (!receiveIsCommodity) {
    bank[receive] -= 1;
    players = state.players.map((p) =>
      p.seat === seat ? { ...p, resources: { ...p.resources, [receive]: p.resources[receive] + 1 } } : p
    );
  }

  const nextState: GameState = {
    ...state,
    players,
    bank,
    ext: { ...state.ext, citiesKnights: { ...ck, commodities } },
  };
  return {
    ok: true,
    state: nextState,
    events: [commodityTraded(seat, give, rate, receive, rate)],
  };
}

/**
 * C4.4: `track` at level L lets `seat` draw a progress card of that colour when the red die shows
 * <= L+1 (level 0 never draws). Pure lookup over the current improvement level — T-804 calls this
 * to decide who draws on an event-die colour gate (C6.2); drawing itself is out of scope here.
 */
export function canDrawProgress(state: GameState, seat: Seat, track: ImprovementTrack, redDie: number): boolean {
  const ck = citiesKnightsExt(state);
  const level = ck?.improvements[seat]?.[track] ?? 0;
  return ckCardDrawEligible(level, redDie);
}
