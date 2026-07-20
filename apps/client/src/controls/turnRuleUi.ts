// T-603: pure turn-rule situation logic for the 5–6 extension's two extra-building rules (X12).
// Kept side-effect-free (no React, no store) so it's directly unit-testable, same split every other
// `controls/**`/`store/uiMode.ts` module uses (pure logic here, presentational `ActionBar.tsx` on
// top). Given a redacted `PlayerView` + the viewer's seat, it classifies which extra-build UI the
// action bar should show:
//
//   - `sbpBuilder`  — 2015 Special Building Phase, and the viewer IS the current builder: show the
//                     build/buy + Pass bar. (During SBP `turn.player` is the seat whose turn just
//                     ended, NOT the builder — the builder is `phase.builder`, redact.ts passes the
//                     whole `specialBuild` phase through, so builder + queue are visible.)
//   - `sbpWaiting`  — SBP in progress, viewer is NOT the builder: show the banner + queue, no bar.
//   - `pairedPartial` — 2022 Paired Players, the current `main` turn is a partial turn and the
//                     viewer is the paired "player 2": show the restricted bar (no roll / no player
//                     trade; supply-trade + build + ≤1 dev card + end). The partial-turn marker
//                     rides on `view.ext.fiveSix.partialTurn` (surfaced by redact.ts, T-603 req 0).
//   - `pairedWaiting` — a partial turn is in progress but the viewer isn't the paired player.
//   - `none`        — no extra-build rule is active; the normal action bar applies.
import type { PlayerView } from '@hexhaven/engine';
import type { Seat } from '@hexhaven/shared';

export type TurnRuleSituation =
  | { kind: 'none' }
  | { kind: 'sbpBuilder'; builder: Seat; queue: Seat[] }
  | { kind: 'sbpWaiting'; builder: Seat; queue: Seat[] }
  | { kind: 'pairedPartial'; builder: Seat; resumeFrom: Seat }
  | { kind: 'pairedWaiting'; builder: Seat; resumeFrom: Seat };

/** The paired-players partial-turn marker, or `null`. Reads the whitelisted field redact.ts exposes. */
export function partialTurnMarker(view: PlayerView): { builder: Seat; resumeFrom: Seat } | null {
  return view.ext?.fiveSix?.partialTurn ?? null;
}

export function turnRuleSituation(view: PlayerView, mySeat: Seat): TurnRuleSituation {
  if (view.phase.kind === 'specialBuild') {
    const { builder, queue } = view.phase;
    return builder === mySeat
      ? { kind: 'sbpBuilder', builder, queue }
      : { kind: 'sbpWaiting', builder, queue };
  }

  const partial = partialTurnMarker(view);
  if (partial != null) {
    // The partial turn is modeled as a restricted `main` turn owned by the paired builder (T-602):
    // `turn.player === partial.builder`. The viewer drives the restricted bar only when it's theirs.
    return partial.builder === mySeat
      ? { kind: 'pairedPartial', builder: partial.builder, resumeFrom: partial.resumeFrom }
      : { kind: 'pairedWaiting', builder: partial.builder, resumeFrom: partial.resumeFrom };
  }

  return { kind: 'none' };
}
