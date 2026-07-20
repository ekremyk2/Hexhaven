// Test-only fixtures for src/endscreen/**'s suite. Mirrors robber/robberLogic.test.ts's approach
// (docs/12): build a real `GameState` via the engine's own `createGame`, override just the
// branches a test cares about, then `redact()` it for a genuinely redacted `PlayerView` — instead
// of hand-rolling a `PlayerView` literal (which would drift from what `redact()` actually
// produces). `@hexhaven/engine`/`@hexhaven/shared` are the published workspace packages every task
// already depends on, not a file this task owns, so importing them here isn't a scope violation.
import { createGame } from '@hexhaven/engine';
import type { GameConfig, GameState } from '@hexhaven/shared';

export const TEST_CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'endscreen-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

export function baseState(): GameState {
  return createGame(TEST_CONFIG);
}
