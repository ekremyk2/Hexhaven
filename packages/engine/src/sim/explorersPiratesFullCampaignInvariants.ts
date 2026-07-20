// T-1114: "The Explorers & Pirates" full campaign scenario's mode-specific invariants (docs/rules/
// explorers-pirates-rules.md §EP1.3(generalized)/§EP2/§EP3/§EP4/§EP7/§EP8/§EP9/§EP12.4). The full
// campaign reuses Land Ho!'s SAME board/movement/founding frame (createGame.ts's generalized E&P
// branch) with ALL THREE missions ON at once (`EP_SCENARIO_CONFIG.fullCampaign`) — fish, spice, AND
// pirate lairs all compete for the same ships/cargo bays/action budget simultaneously, so this
// scenario needs every mission's own invariant set asserted together, not just one of them.
//
// Rather than re-copy EP-FISH1-5/EP-SPICE1-6/EP-LAIR1-7's bodies a fourth time (each single-mission
// file is already an intentional independent copy of the shared cargo/ship/harbor/fog checks per
// their own "every scenario file is self-contained" precedent — explorersPiratesSpiceInvariants.ts's
// header), this file COMPOSES the three existing check functions by calling all three against the
// SAME transition, threading three independent accumulators. None of the three check functions reads
// `state.ext.explorersPirates.scenario` — every one of them is a pure function of `state`/`events`/
// its own accumulator, so calling all three on a full-campaign state is exactly as valid as calling
// any one of them on its own single-mission state; EP-FISH1-4/EP-SPICE1-4/EP-LAIR1-4 will just
// (harmlessly) re-assert the identical cargo-cap/ship-cap/harbor/fog checks three times over, and
// EP-FISH5/EP-SPICE5-6/EP-LAIR5-7 each assert their own mission's VP/crew bookkeeping independently.
// This is a "reuse/compose", not a duplicate — fixing a bug in, say, the fog-leak check only ever
// requires editing ONE of the three single-mission files (whichever the bug was found in); the fix
// implicitly covers the full campaign the next time this composition runs it. Neither of the three
// single-mission files (nor their own RK-13-adjacent byte-identity requirements) is touched by this
// task, and none of their own scenarios' behavior changes.

import type { Action, GameEvent, GameState } from '@hexhaven/shared';
import {
  ExplorersPiratesFishInvariantViolationError,
  checkExplorersPiratesFishInvariants,
  initialExplorersPiratesFishAccumulator,
} from './explorersPiratesFishInvariants.js';
import type { ExplorersPiratesFishAccumulator } from './explorersPiratesFishInvariants.js';
import {
  ExplorersPiratesSpiceInvariantViolationError,
  checkExplorersPiratesSpiceInvariants,
  initialExplorersPiratesSpiceAccumulator,
} from './explorersPiratesSpiceInvariants.js';
import type { ExplorersPiratesSpiceAccumulator } from './explorersPiratesSpiceInvariants.js';
import {
  ExplorersPiratesPirateLairsInvariantViolationError,
  checkExplorersPiratesPirateLairsInvariants,
  initialExplorersPiratesPirateLairsAccumulator,
} from './explorersPiratesPirateLairsInvariants.js';
import type { ExplorersPiratesPirateLairsAccumulator } from './explorersPiratesPirateLairsInvariants.js';

// Re-exported so a caller (runGame.ts, tests) can catch any of the three underlying violation
// classes without importing all three single-mission modules directly.
export {
  ExplorersPiratesFishInvariantViolationError,
  ExplorersPiratesSpiceInvariantViolationError,
  ExplorersPiratesPirateLairsInvariantViolationError,
};

/** The three single-mission accumulators, run side by side against the SAME full-campaign
 *  transition (this file's own header explains why composing rather than re-deriving is valid). */
export interface ExplorersPiratesFullCampaignAccumulator {
  fish: ExplorersPiratesFishAccumulator;
  spice: ExplorersPiratesSpiceAccumulator;
  lairs: ExplorersPiratesPirateLairsAccumulator;
}

export function initialExplorersPiratesFullCampaignAccumulator(): ExplorersPiratesFullCampaignAccumulator {
  return {
    fish: initialExplorersPiratesFishAccumulator(),
    spice: initialExplorersPiratesSpiceAccumulator(),
    lairs: initialExplorersPiratesPirateLairsAccumulator(),
  };
}

/**
 * Runs EP-FISH1-5 AND EP-SPICE1-6 AND EP-LAIR1-7 against one successful full-campaign transition
 * (threading each mission's own running accumulator independently). Throws on the FIRST violation
 * any of the three raises (fish checked first, then spice, then lairs — an arbitrary but fixed
 * order); returns the combined accumulator otherwise. No-op passthrough outside a full-campaign game
 * (each underlying check function already tolerates an absent `ext.explorersPirates` — see their own
 * `epExt(state)` early-return guards).
 */
export function checkExplorersPiratesFullCampaignInvariants(
  state: GameState,
  action: Action,
  events: readonly GameEvent[],
  acc: ExplorersPiratesFullCampaignAccumulator
): ExplorersPiratesFullCampaignAccumulator {
  const fish = checkExplorersPiratesFishInvariants(state, action, events, acc.fish);
  const spice = checkExplorersPiratesSpiceInvariants(state, action, events, acc.spice);
  const lairs = checkExplorersPiratesPirateLairsInvariants(state, action, events, acc.lairs);
  return { fish, spice, lairs };
}
