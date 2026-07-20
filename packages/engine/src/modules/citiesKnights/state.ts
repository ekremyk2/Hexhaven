// Cities & Knights ext-state helpers (T-801 data-model scaffolding,
// docs/rules/cities-knights-rules.md §C2/§C12). All C&K piece/track data lives under
// `state.ext.citiesKnights` (docs/10 §3) so base fields never change meaning; these thin
// accessors are the single read/write surface — mirroring `modules/seafarers/state.ts`. Every
// accessor is a no-op / default for a non-C&K game. Dormant: `citiesKnightsModule` isn't wired
// into `resolveModules` yet (T-802+), so `initCitiesKnightsExt` is exercised only by its own unit
// tests today.

import type { CitiesKnightsExt, Commodity, GameState, ImprovementTrack, ProgressCardId, Seat } from '@hexhaven/shared';
import { ckDeckCards } from '@hexhaven/shared';
import { shuffle } from '../../rng.js';

const ZERO_COMMODITIES: Readonly<Record<Commodity, number>> = { paper: 0, cloth: 0, coin: 0 };
const ZERO_IMPROVEMENTS: Readonly<Record<ImprovementTrack, number>> = { trade: 0, politics: 0, science: 0 };
const TRACKS: readonly ImprovementTrack[] = ['trade', 'politics', 'science'];

/** Is this a C&K game? (`ext.citiesKnights` is only ever set for one — dormant today.) */
export function isCitiesKnightsState(state: GameState): boolean {
  return state.ext?.citiesKnights !== undefined;
}

/** The citiesKnights ext block, or `undefined` in a non-C&K game. */
export function citiesKnightsExt(state: GameState): CitiesKnightsExt | undefined {
  return state.ext?.citiesKnights;
}

/** A seat's commodity holdings (C3.1), or all-zero when there is no C&K state. */
export function commoditiesOf(state: GameState, seat: Seat): Readonly<Record<Commodity, number>> {
  return state.ext?.citiesKnights?.commodities[seat] ?? ZERO_COMMODITIES;
}

/**
 * Build the initial C&K ext for `playerCount` players (C2.2/C12): zeroed per-seat commodities and
 * improvement levels, empty knights/walls/progress hands, the barbarian ship at the start of its
 * track (C8.1), no metropolis yet (C4.6), the robber locked in the desert (C10.1), no merchant
 * placed (C6.5), and the three progress-card decks shuffled from the C6.5 composition
 * (`CK_PROGRESS_DECK_COMPOSITION`) using the passed seeded rng — no `Math.random` (docs/05 §2).
 * Returns the advanced rng state alongside the ext, threaded the same way `generateScenarioBoard`
 * (seafarers/board.ts) threads its shuffles.
 */
export function initCitiesKnightsExt(
  playerCount: number,
  rng: number
): { ext: CitiesKnightsExt; rng: number } {
  let s = rng;
  const progressDecks = {} as Record<ImprovementTrack, ProgressCardId[]>;
  for (const track of TRACKS) {
    const draw = shuffle(s, ckDeckCards(track));
    s = draw.state;
    progressDecks[track] = draw.array;
  }

  const ext: CitiesKnightsExt = {
    commodities: Array.from({ length: playerCount }, () => ({ ...ZERO_COMMODITIES })),
    improvements: Array.from({ length: playerCount }, () => ({ ...ZERO_IMPROVEMENTS })),
    knights: Array.from({ length: playerCount }, () => []),
    walls: Array.from({ length: playerCount }, () => []),
    progressHand: Array.from({ length: playerCount }, () => []),
    defenderVp: Array.from({ length: playerCount }, () => 0),
    // C8.1/C8.2: the ship starts at the beginning of its track, no attacks resolved yet.
    barbarian: { position: 0, attacksResolved: 0 },
    // C4.6: exactly 3 metropolises exist, one per track — none placed until a player first reaches L4.
    metropolis: { trade: null, politics: null, science: null },
    progressDecks,
    merchant: null,
    // C10.1: robber locked in the desert until the first barbarian attack resolves.
    robberLocked: true,
    // T-804: no pending Alchemist override, no revealed +1VP progress cards yet.
    alchemistForced: null,
    revealedProgress: {},
    // Spy peek reveal (redact.ts hidden-info UX fix): no pending peeks at game start.
    spyPeek: Array.from({ length: playerCount }, () => null),
  };

  return { ext, rng: s };
}
