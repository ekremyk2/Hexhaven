import { describe, expect, it } from 'vitest';
import type { Phase, Seat } from '@hexhaven/shared';
import { phaseTextKey } from './phaseText';

const P1 = 1 as Seat;

describe('phaseTextKey (T-402 requirement 3: phase -> i18n key map)', () => {
  it.each<[Phase, string]>([
    [{ kind: 'setup', round: 1, expect: 'settlement', lastSettlement: null }, 'hud.phase.setup.settlement'],
    [{ kind: 'setup', round: 1, expect: 'road', lastSettlement: null }, 'hud.phase.setup.road'],
    [{ kind: 'preRoll' }, 'hud.phase.preRoll'],
    [{ kind: 'discard', pending: [P1], amounts: { [P1]: 4 } as never }, 'hud.phase.discard'],
    [{ kind: 'moveRobber', returnTo: 'main' }, 'hud.phase.moveRobber'],
    [{ kind: 'steal', candidates: [P1], returnTo: 'main' }, 'hud.phase.steal'],
    [{ kind: 'roadBuilding', remaining: 2 }, 'hud.phase.roadBuilding'],
    [{ kind: 'main' }, 'hud.phase.main'],
    [{ kind: 'ended', winner: P1 }, 'hud.phase.ended'],
  ])('maps %o to %s', (phase, key) => {
    expect(phaseTextKey(phase)).toBe(key);
  });
});
