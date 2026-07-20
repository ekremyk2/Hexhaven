// "The Pirate Islands" (T-758, Seafarers 5–6 extension, docs/tasks/phase-7b/T-758-pirate-islands-56.md)
// NEW MECHANIC: the pirate moves automatically along a fixed track — no 7/knight needed. Mirrors
// gold.ts's/cloth.ts's production-on-roll shape (folded into the SAME dice-roll hook,
// modules/seafarers/index.ts's `afterAction`) — NO new Action/GameEvent.
//
// Model (PM-decided, task spec): on every dice roll, advance the pirate ONE step along the scenario's
// ordered `pirateTrack` (`board.ts`'s `scenarioPirateTrackFor`), wrapping at the end — deterministic,
// pure track-driven, no `rng` draw (unlike the manual S8 `movePirate`, which is a player CHOICE).
// `ext.seafarers.pirateTrackIndex` is `undefined` for every OTHER scenario (state.ts's
// `initialSeafarersExt` only ever sets it for Pirate Islands), so `advancePirateTrack` is a no-op
// (returns `state` unchanged, reference-equal) everywhere else — RK-13/other-scenario byte identity,
// exactly like `cloth.ts`'s `applyClothGains`.

import type { GameState } from '@hexhaven/shared';
import { scenarioPirateTrackFor } from './board.js';
import { seafarersExt, withSeafarersExt } from './state.js';

/**
 * S8.2-analogue: advance the pirate one step along the Pirate Islands track (wrapping), updating
 * `pirate`/`pirateTrackIndex`/`pirateTrackSafe` together so they never drift out of sync. Returns
 * `state` unchanged (reference-equal) when this isn't a Pirate Islands game (`pirateTrackIndex`
 * absent) or the resolved track is empty (defensive; scenario data guarantees non-empty).
 */
export function advancePirateTrack(state: GameState): GameState {
  const ext = seafarersExt(state);
  if (!ext || ext.pirateTrackIndex === undefined) return state;
  const track = scenarioPirateTrackFor(state.config);
  if (track.length === 0) return state;

  const nextIndex = (ext.pirateTrackIndex + 1) % track.length;
  const entry = track[nextIndex];
  if (!entry) return state; // defensive: nextIndex is always in range for a non-empty track

  return withSeafarersExt(state, {
    ...ext,
    pirate: entry.hex,
    pirateTrackIndex: nextIndex,
    pirateTrackSafe: entry.safe,
  });
}
