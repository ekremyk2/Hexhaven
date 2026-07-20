// Cities & Knights client helpers (T-806): pure, store-agnostic lookups over a redacted
// `PlayerView` — the single place every C&K UI piece (board mount, HUD, action bar, dialogs) reads
// `view.ext.citiesKnights` from, so the "is this a C&K game" gate and the metropolis-anchor
// approximation are never re-derived ad hoc. Mirrors `actionBarLogic.ts`'s `isSeafarersGame`
// precedent exactly.
import type { PlayerView } from '@hexhaven/engine';
import { CK_KNIGHT_CAP } from '@hexhaven/shared';
import type { HexId, ImprovementTrack, Knight, KnightLevel, Seat, VertexId } from '@hexhaven/shared';

/** The `ext.citiesKnights` block's shape, as `redact.ts` exposes it to any viewer. */
export type CitiesKnightsView = NonNullable<NonNullable<PlayerView['ext']>['citiesKnights']>;

/** Is this a Cities & Knights game? (docs/rules/cities-knights-rules.md C12 — the ext block only
 *  ever exists for one.) Every C&K UI piece gates on this so base/fiveSix/Seafarers rendering and
 *  behavior stay untouched (RK-13). */
export function isCitiesKnightsGame(view: PlayerView): boolean {
  return view.ext?.citiesKnights != null;
}

/** The C&K public state, or `undefined` outside a C&K game. */
export function ckOf(view: PlayerView): CitiesKnightsView | undefined {
  return view.ext?.citiesKnights;
}

export const IMPROVEMENT_TRACKS: readonly ImprovementTrack[] = ['trade', 'politics', 'science'];

/**
 * Metropolis anchor-vertex resolution (documented choice, T-805/T-806): `CitiesKnightsExt.
 * metropolis` (C4.6) tracks ownership PER TRACK, not per vertex, so rendering a metropolis marker
 * (which needs a vertex) requires picking one of the owner's cities. We anchor on the LOWEST
 * VertexId among the owner's current cities — deterministic and stable, since a metropolis city can
 * never be pillaged/reduced (C8.6 "metropolis cities are immune") so the anchor never needs to move
 * once chosen (short of a level-5 capture, C4.6, which transfers to the NEW owner's own lowest city
 * the next time this is computed).
 */
export function metropolisAnchors(view: PlayerView): { vertex: VertexId; track: ImprovementTrack }[] {
  const ck = ckOf(view);
  if (!ck) return [];
  const out: { vertex: VertexId; track: ImprovementTrack }[] = [];
  for (const track of IMPROVEMENT_TRACKS) {
    const owner = ck.metropolis[track];
    if (owner == null) continue;
    const player = view.players.find((p) => p.seat === owner);
    const cities = player?.cities ?? [];
    if (cities.length === 0) continue;
    const vertex = [...cities].sort((a, b) => a - b)[0]!;
    out.push({ vertex, track });
  }
  return out;
}

/** Every knight on the board, flattened from the per-seat arrays (for `<CitiesKnightsPieces>`). */
export function flattenKnights(view: PlayerView): { vertex: VertexId; seat: Seat; level: KnightLevel; active: boolean }[] {
  const ck = ckOf(view);
  if (!ck) return [];
  return ck.knights.flatMap((list: Knight[], seat) => list.map((k) => ({ ...k, seat: seat as Seat })));
}

/** Every city wall on the board, flattened from the per-seat arrays (for `<CitiesKnightsPieces>`). */
export function flattenWalls(view: PlayerView): { vertex: VertexId; seat: Seat }[] {
  const ck = ckOf(view);
  if (!ck) return [];
  return ck.walls.flatMap((list, seat) => list.map((vertex) => ({ vertex, seat: seat as Seat })));
}

/** Structural shape shared by `GameState.ext.citiesKnights` (engine-internal) and `PlayerView.ext.
 *  citiesKnights` (this file's `CitiesKnightsView`) for the two fields below — lets
 *  `activatableKnightVertices`/`promotableKnightVertices` serve both `store/uiMode.ts` (which treats
 *  its `view` param as a full engine `GameState`, per that module's own documented WIRE workaround)
 *  and any PlayerView-typed caller, without importing `GameState`/`CitiesKnightsExt` here. */
interface KnightsAndImprovements {
  knights: readonly (readonly Knight[])[];
  improvements: readonly Record<ImprovementTrack, number>[];
}

/** Board-pick targets for `activatingKnight` (C7.2): `seat`'s own INACTIVE knights — no
 *  connectivity/cost gate needed (activating never moves a piece), so this is plain client-side
 *  filtering over already-public data, not a rule reimplementation. */
export function activatableKnightVertices(ck: KnightsAndImprovements, seat: Seat): VertexId[] {
  return (ck.knights[seat] ?? []).filter((k) => !k.active).map((k) => k.vertex);
}

/** Board-pick targets for `promotingKnight` (C7.2/C7.3): `seat`'s own knights below the max level,
 *  respecting the Fortress gate for strong->mighty (C4.5) AND the per-level cap on the TARGET level
 *  (C7.1 — `CK_KNIGHT_CAP`, e.g. only 2 strong knights allowed at once) — both are public facts
 *  already exposed by `redact.ts`, so this stays plain filtering rather than reimplementing engine
 *  validation. Bug fix: previously omitted the target-cap check, so the client offered promotions
 *  the engine's `promoteKnight` then rejected with `KNIGHT_CAP` (offer must equal engine legality,
 *  same lesson as B-28). */
export function promotableKnightVertices(ck: KnightsAndImprovements, seat: Seat): VertexId[] {
  const hasFortress = (ck.improvements[seat]?.politics ?? 0) >= 3;
  const knights = ck.knights[seat] ?? [];
  return knights
    .filter((k) => {
      if (k.level >= 3 || (k.level >= 2 && !hasFortress)) return false;
      const nextLevel = (k.level + 1) as KnightLevel;
      const countAtNext = knights.filter((x) => x.level === nextLevel).length;
      return countAtNext < CK_KNIGHT_CAP[nextLevel];
    })
    .map((k) => k.vertex);
}

// ---------------------------------------------------------------------------------------------
// Progress-card play-dialog target lists (T-806, Priority 3). The GEOMETRY-dependent ones
// (merchant hexes, diplomat roads, deserter placement, intrigue targets) live in the engine
// (`@hexhaven/engine`); these four need only the PUBLIC `PlayerView` (board tiles, own buildings,
// commodity/VP counts) so they stay client-side, pure lookups.
// ---------------------------------------------------------------------------------------------

/** Medicine (C6.5): `seat`'s own settlements that could be upgraded to a city — needs a city piece
 *  left in supply (the 2 ore + 1 grain cost is the engine handler's concern; this only lists targets,
 *  mirroring `legalCityVertices`'s target-vs-affordability split). */
export function medicineVertices(view: PlayerView, seat: Seat): VertexId[] {
  const player = view.players.find((p) => p.seat === seat);
  if (!player || !('piecesLeft' in player) || player.piecesLeft.cities <= 0) return [];
  return 'settlements' in player ? [...player.settlements] : [];
}

/** Inventor (C6.5): every numbered hex whose token may be relocated — excludes the two
 *  highest-probability tokens (6 and 8) per the printed restriction (progressCards.ts's own
 *  `INVENTOR_RESTRICTED_NUMBER` gate). Reads the public `view.board.hexes`. */
export function inventorHexes(view: PlayerView): HexId[] {
  return view.board.hexes
    .map((tile, id) => ({ tile, id: id as HexId }))
    .filter(({ tile }) => tile.token !== null && tile.token !== 6 && tile.token !== 8)
    .map(({ id }) => id);
}

/** Bishop (C6.5): every hex the robber could move to (any but its current one) — but only once the
 *  robber is unlocked (C10.1: no robber movement before the first barbarian attack). Reads public
 *  board state; empty (and the card unplayable) while `robberLocked`. */
export function bishopHexes(view: PlayerView): HexId[] {
  const ck = ckOf(view);
  if (!ck || ck.robberLocked) return [];
  return view.board.hexes.map((_, id) => id as HexId).filter((id) => id !== view.board.robber);
}

/**
 * A seat's VP computed from PUBLIC data only (C&K-aware) — used to gate Master Merchant's "more VP
 * than you" targets. The engine's own `publicVp`/`computeVp` need a full `GameState` (every player's
 * `devCards`), which a redacted `PlayerView` does NOT carry for opponents — so this recomputes the
 * public components directly: settlements (1) + cities (2) + metropolises held (+2 each, C4.6) +
 * Defender-of-Hexhaven cards (+1 each, C8.5) + revealed Printer/Constitution (+1 each, C6.3) + Longest
 * Road (2). Largest Army is removed in C&K (C11.2). In C&K there are no hidden VP dev cards (C11), so
 * this public total equals the true total for the Master Merchant comparison. The engine still
 * validates `NOT_ELIGIBLE` authoritatively — this only shapes the offered list.
 */
export function publicVpInView(view: PlayerView, seat: Seat): number {
  const player = view.players.find((p) => p.seat === seat);
  if (!player) return 0;
  let vp = player.settlements.length + player.cities.length * 2;
  if (view.awards.longestRoad.holder === seat) vp += 2;
  const ck = ckOf(view);
  if (ck) {
    for (const track of IMPROVEMENT_TRACKS) if (ck.metropolis[track] === seat) vp += 2;
    vp += ck.defenderVp[seat] ?? 0;
    if (ck.revealedProgress.printer === seat) vp += 1;
    if (ck.revealedProgress.constitution === seat) vp += 1;
  }
  return vp;
}

/** Master Merchant (C6.5): opponents with STRICTLY more VP than `seat` — the only legal targets
 *  (uses `publicVpInView`, C&K-aware, computed from the redacted view). */
export function masterMerchantSeats(view: PlayerView, seat: Seat): Seat[] {
  const mine = publicVpInView(view, seat);
  return view.players.filter((p) => p.seat !== seat && publicVpInView(view, p.seat) > mine).map((p) => p.seat);
}

/** Every OTHER seat that holds ≥1 progress card — the legal Spy targets (C6.5). Uses the public
 *  `progressHandCounts` (hand SIZES are public; identities are only revealed via the `peekSpyTarget`
 *  two-step, `ck.spyPeek` — see the Spy dialog's own header comment). */
export function spyTargetSeats(view: PlayerView, seat: Seat): Seat[] {
  const ck = ckOf(view);
  if (!ck) return [];
  return view.players
    .filter((p) => p.seat !== seat && (ck.progressHandCounts[p.seat] ?? 0) > 0)
    .map((p) => p.seat);
}
