// Traders & Barbarians client helpers (T-1008): pure, store-agnostic lookups over a redacted
// `PlayerView` — the single place every T&B UI piece (HUD, action panel, board layer) reads
// `view.ext.tradersBarbarians` from, mirroring `citiesKnights/ckHelpers.ts`'s `ckOf`/
// `isCitiesKnightsGame` precedent exactly. T&B is a COMPILATION of five standalone scenarios
// (docs/rules/traders-barbarians-rules.md TB1.1) — every helper below is gated on the active
// `scenario` string so a component never has to re-check "is this scenario active" itself.
import type { PlayerView } from '@hexhaven/engine';
import type { EdgeId, HexId, Seat, TBCommodity, VertexId } from '@hexhaven/shared';

/** The `ext.tradersBarbarians` block's shape, as `redact.ts` exposes it to any viewer. */
export type TradersBarbariansView = NonNullable<NonNullable<PlayerView['ext']>['tradersBarbarians']>;

export type TBScenarioId = 'fishermen' | 'rivers' | 'caravans' | 'barbarianAttack' | 'tradersBarbarians';

/** Is this a Traders & Barbarians game at all (any of the 5 scenarios)? */
export function isTradersBarbariansGame(view: PlayerView): boolean {
  return view.ext?.tradersBarbarians != null;
}

/** The T&B public state, or `undefined` outside a T&B game. */
export function tbOf(view: PlayerView): TradersBarbariansView | undefined {
  return view.ext?.tradersBarbarians;
}

function scenarioOf(view: PlayerView): string | undefined {
  return tbOf(view)?.scenario;
}

export function isFishermenGame(view: PlayerView): boolean {
  return scenarioOf(view) === 'fishermen';
}
export function isRiversGame(view: PlayerView): boolean {
  return scenarioOf(view) === 'rivers';
}
export function isCaravansGame(view: PlayerView): boolean {
  return scenarioOf(view) === 'caravans';
}
export function isBarbarianAttackGame(view: PlayerView): boolean {
  return scenarioOf(view) === 'barbarianAttack';
}
export function isTradersBarbariansMainGame(view: PlayerView): boolean {
  return scenarioOf(view) === 'tradersBarbarians';
}

/** The viewer's own VP, computed from PUBLIC data only (mirrors `ckHelpers.ts`'s `publicVpInView` —
 *  settlements/cities/awards are public for every seat) — used by the Old Boot pass / caravan-vote
 *  UI to offer only legal targets without reimplementing engine rules. T&B never combines with
 *  Cities & Knights (TB8.1), so this never needs the C&K-aware extras `publicVpInView` also folds in. */
export function publicVpInTbView(view: PlayerView, seat: Seat): number {
  const player = view.players.find((p) => p.seat === seat);
  if (!player) return 0;
  let vp = player.settlements.length + player.cities.length * 2;
  if (view.awards.longestRoad.holder === seat) vp += 2;
  if (view.awards.largestArmy.holder === seat) vp += 2;
  return vp;
}

/** Fishermen (§TB2.5): opponents the Old Boot's current holder may legally pass it to — every seat
 *  the holder is trailing OR TIED with (never a strictly weaker seat, or it stops being a catch-up
 *  mechanic). Empty outside a fishermen game / for a non-holder. */
export function oldBootPassTargets(view: PlayerView, seat: Seat): Seat[] {
  if (!isFishermenGame(view)) return [];
  const tb = tbOf(view);
  if (!tb || tb.oldBoot !== seat) return [];
  const mine = publicVpInTbView(view, seat);
  return view.players.filter((p) => p.seat !== seat && publicVpInTbView(view, p.seat) >= mine).map((p) => p.seat);
}

/** Every knight on the board (barbarianAttack, §TB5.2), flattened for board rendering — mirrors
 *  `ckHelpers.ts`'s `flattenKnights` shape (this scenario's knights are EDGE pieces, not vertex). */
export function tbKnights(view: PlayerView): { edge: EdgeId; seat: Seat; active: boolean }[] {
  return tbOf(view)?.knights ?? [];
}

/** The seat's own knight edges (active or not) — used by the action panel to build the "move knight"
 *  source list without duplicating the board-mode target logic in `store/uiMode.ts`. */
export function ownActiveKnightEdges(view: PlayerView, seat: Seat): EdgeId[] {
  return tbKnights(view)
    .filter((k) => k.seat === seat && k.active)
    .map((k) => k.edge);
}

/** Every wagon belonging to `seat` (the main scenario, §TB6.2), tagged with its array INDEX — the
 *  index is what `moveWagon.wagon` addresses (see the engine's own header comment on that field). */
export function ownWagons(
  view: PlayerView,
  seat: Seat,
): { index: number; at: VertexId; cargo: TBCommodity | null }[] {
  const wagons = tbOf(view)?.wagons ?? [];
  return wagons
    .map((w, index) => ({ ...w, index }))
    .filter((w) => w.seat === seat)
    .map(({ index, at, cargo }) => ({ index, at, cargo }));
}

/** The fixed trade-hex layout (main scenario, §TB6.1) as a lookup by hex id, for board glyphs. */
export function tradeHexKindByHex(view: PlayerView): Map<HexId, 'quarry' | 'glassworks' | 'castle'> {
  const out = new Map<HexId, 'quarry' | 'glassworks' | 'castle'>();
  for (const th of tbOf(view)?.tradeHexes ?? []) out.set(th.hex, th.kind);
  return out;
}
