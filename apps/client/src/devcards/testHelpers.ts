// Shared test-only fixtures for src/devcards/**'s test suite — mirrors `controls/ActionBar.test.ts`'s
// `craftMainState`/`asView` pattern (a crafted `GameState` cast to `PlayerView`, WIRE: T-204).
import { createGame } from '@hexhaven/engine';
import type { PlayerView } from '@hexhaven/engine';
import type { DevCardType, GameConfig, GameState, Seat } from '@hexhaven/shared';

export const CONFIG: GameConfig = {
  playerCount: 4,
  targetVp: 10,
  seed: 'devcards-test',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

export const SEAT0 = 0 as Seat;
export const SEAT1 = 1 as Seat;
export const SEAT2 = 2 as Seat;
export const SEAT3 = 3 as Seat;

export function asView(state: GameState, me: Seat = SEAT0): PlayerView {
  return { ...state, me, devDeckCount: state.devDeck.length } as unknown as PlayerView;
}

/** A seat-0-owned main-phase, already-rolled game, with `seatOverrides` merged onto seat 0's
 * `PlayerState` and `stateOverrides` merged onto the top-level `GameState` LAST (so a caller can
 * override `phase`/`turn` themselves). */
export function craft(
  seatOverrides: Partial<GameState['players'][number]> = {},
  stateOverrides: Partial<GameState> = {},
): GameState {
  const g = createGame(CONFIG);
  const players = g.players.map((p) => (p.seat === SEAT0 ? { ...p, ...seatOverrides } : p));
  return {
    ...g,
    players,
    phase: { kind: 'main' },
    turn: { ...g.turn, player: SEAT0, rolled: true },
    ...stateOverrides,
  };
}

export function devCard(type: DevCardType, boughtOnTurn: number): { type: DevCardType; boughtOnTurn: number } {
  return { type, boughtOnTurn };
}

/** Attribute string between a `data-testid="X"` marker and the tag's closing `>` — same helper
 * `controls/ActionBar.test.ts` defines locally; kept here so every devcards test file shares one
 * copy instead of redeclaring it. */
export function attrsFor(html: string, testid: string): string {
  const match = html.match(new RegExp(`data-testid="${testid}"([^>]*)>`));
  if (!match) throw new Error(`BUG: no element with data-testid="${testid}" in:\n${html}`);
  return match[1]!;
}

/** `Button`'s `disabled` prop renders the real boolean HTML attribute `disabled=""` when true and
 * omits it when false — distinct from the ALWAYS-rendered `aria-disabled="true"|"false"`. */
export function isDisabled(html: string, testid: string): boolean {
  return attrsFor(html, testid).includes('disabled=""');
}
