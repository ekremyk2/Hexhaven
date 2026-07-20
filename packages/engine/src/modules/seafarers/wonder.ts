// "The Wonders of Hexhaven" (T-759, Seafarers 5–6 extension, FINAL scenario,
// docs/tasks/phase-7b/T-759-wonders-of-hexhaven-56.md). NEW MECHANIC: players build a wonder in stages;
// completing every stage is an ALTERNATE WIN, in parallel with the normal VP-target race.
//
// The official game has players actively BUY wonder stages with dedicated resource sets — a new
// build Action, which this task's PM-decided LOW-RISK model explicitly avoids (the exhaustive-switch
// cascade docs/10 §3 warns against). Instead, wonder progress is DERIVED from pieces a seat already
// builds: `advanceWonderProgress` below is folded into the SAME settlement/city build afterAction
// hook (`modules/seafarers/index.ts`) that grants island chits/lair captures — a stage completes once
// the seat's cities+settlements COUNT crosses that stage's rising `WONDER_THRESHOLDS` entry WHILE
// their CURRENT hand (checked right after the triggering build's own cost was already paid) happens
// to hold that stage's `WONDER_STAGE_COSTS` resource stockpile — a best-effort proxy for "developed
// and resourced enough to plausibly have bought this many wonder stages" (⚠ VERIFY heavily — every
// number below is this task's own v1 invention, sim-tuned only to confirm the alternate win actually
// decides some games; see scenario.ts's WONDERS_OF_HEXHAVEN.verify). NO new Action/GameEvent/Phase/
// ErrorCode: like cloth/lair-capture before it, a silently-applied ext update needs no event of its
// own — the client reads the new PUBLIC `ext.seafarers.wonder` field straight off state.
//
// ALTERNATE WIN: `vp.ts`'s `checkWin` is the ONLY place this reaches into engine-core (the phase's
// highest RK-13 risk per the task spec) — gated STRICTLY on `isWondersOfHexhavenState` (`ext.seafarers.
// wonder` presence, absent for base + every OTHER scenario/game), so the win-check's normal-VP branch
// stays byte-for-byte unchanged everywhere else.

import type { GameState, ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';
import { seafarersExt, withSeafarersExt, wonderStagesOf } from './state.js';

/** ⚠ VERIFY (T-759's own v1 DECISION — no printed booklet in hand): the wonder has this many stages. */
export const WONDER_STAGES = 4;

/** ⚠ VERIFY: the rising cities+settlements COUNT (`player.settlements.length + player.cities.length`)
 *  a seat must reach to complete stage `i` (0-indexed) — a best-effort proxy for "enough development
 *  to have plausibly bought this many wonder stages". Sim-tuned (T-759 PM review): the FINAL stage
 *  lands at 5 pieces, which a developing player reaches mid-to-late game — early enough that
 *  completing the wonder can beat the raw VP-target race (so the alternate win actually DECIDES games,
 *  at BOTH 5p and 6p, not just accrues silently — the exact fog/cloth "the mechanic never fired"
 *  lesson), late enough that it isn't a turn-one formality. Well within the default 5-settlement /
 *  4-city piece caps (a seat occupies up to 9 distinct spots over a game by recycling settlement
 *  pieces freed on city upgrades, R7.5). */
export const WONDER_THRESHOLDS: readonly number[] = [2, 3, 4, 5];

/** ⚠ VERIFY: the resource STOCKPILE a seat must be holding (merely holding, not spent — checked
 *  against the seat's hand AFTER the triggering build's own cost was already paid) to complete stage
 *  `i` — the proxy for "and could also afford this stage's wonder cost". Deliberately MODEST + uniform
 *  (T-759 PM review): a heavier/escalating stockpile made the final stage rarely coincide with a
 *  build's leftover hand, so 5p games never completed a wonder before the VP race ended. `ore + grain`
 *  (the city-building resources a wonder-racing player naturally hoards) at 1 each keeps every stage
 *  genuinely reachable at both counts while still gating on "actually resourced", not free. */
export const WONDER_STAGE_COSTS: readonly ResourceBundle[] = [
  { ore: 1, grain: 1 },
  { ore: 1, grain: 1 },
  { ore: 1, grain: 1 },
  { ore: 1, grain: 1 },
];

if (WONDER_THRESHOLDS.length !== WONDER_STAGES || WONDER_STAGE_COSTS.length !== WONDER_STAGES) {
  throw new Error('BUG: WONDER_THRESHOLDS/WONDER_STAGE_COSTS length must match WONDER_STAGES');
}

/** Is `state` a Wonders of Hexhaven game? (`ext.seafarers.wonder` present.) Gates BOTH the build hook
 *  (this file) and `vp.ts`'s win-check — absent for base + every other scenario, so every other
 *  game's behavior is untouched (same discipline as `isClothForHexhavenState`/`isPirateIslandsState`). */
export function isWondersOfHexhavenState(state: GameState): boolean {
  return seafarersExt(state)?.wonder !== undefined;
}

/** Has `seat` completed EVERY wonder stage? Always `false` outside a Wonders of Hexhaven game. */
export function wonderComplete(state: GameState, seat: Seat): boolean {
  return wonderStagesOf(state, seat) >= WONDER_STAGES;
}

/** Does `resources` hold at least `cost`'s amount of every resource it lists? */
function holds(resources: Record<ResourceType, number>, cost: ResourceBundle): boolean {
  return (Object.entries(cost) as [ResourceType, number][]).every(([r, n]) => (resources[r] ?? 0) >= n);
}

/**
 * If `seat` just built a settlement/city (the seafarers module's afterAction hook calls this after
 * EVERY successful `buildSettlement`/`buildCity`), advance their wonder progress as far as the rising
 * thresholds + held resource stockpile allow (usually 0 or 1 stage per call, but loops in case a
 * widened piece cap ever lets two thresholds clear in one build). Returns `null` when there is
 * nothing to grant (no Wonders of Hexhaven ext, or no further stage newly qualifies) — callers can skip
 * the state update cheaply, mirroring `computeClothGains`/`grantLairCapture`'s `null` convention.
 */
export function advanceWonderProgress(state: GameState, seat: Seat): { state: GameState } | null {
  const ext = seafarersExt(state);
  if (!ext?.wonder) return null;

  const player = state.players[seat];
  if (!player) return null;
  const totalPieces = player.settlements.length + player.cities.length;

  let stagesDone = ext.wonder[seat] ?? 0;
  let advanced = false;
  while (
    stagesDone < WONDER_STAGES &&
    totalPieces >= WONDER_THRESHOLDS[stagesDone]! &&
    holds(player.resources, WONDER_STAGE_COSTS[stagesDone]!)
  ) {
    stagesDone += 1;
    advanced = true;
  }
  if (!advanced) return null;

  const wonder = ext.wonder.map((s, i) => (i === seat ? stagesDone : s));
  return { state: withSeafarersExt(state, { ...ext, wonder }) };
}

/** Wonders of Hexhaven VP (T-759, optional visibility per the task spec): 1 VP per completed stage, so
 *  progress is visible on the scoreboard even before the wonder is fully complete (⚠ VERIFY — the real
 *  game may not award incremental VP for partial wonder progress). `0` for a base game or any
 *  scenario other than Wonders of Hexhaven. */
export function wonderVp(state: GameState, seat: Seat): number {
  return wonderStagesOf(state, seat);
}
