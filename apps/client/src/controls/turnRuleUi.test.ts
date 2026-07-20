// T-603 requirement 4/6: the pure turn-rule classifier that drives which extra-build UI the action
// bar shows. Crafted minimal `PlayerView`s (only the fields `turnRuleSituation` reads).
import { describe, expect, it } from 'vitest';
import type { PlayerView } from '@hexhaven/engine';
import type { Seat } from '@hexhaven/shared';
import { partialTurnMarker, turnRuleSituation } from './turnRuleUi';

function view(partial: Partial<PlayerView>): PlayerView {
  return partial as PlayerView;
}

const S = (n: number) => n as Seat;

describe('turnRuleSituation — 2015 Special Building Phase', () => {
  const sbp = view({
    phase: { kind: 'specialBuild', builder: S(2), queue: [S(3), S(4), S(5), S(0)] },
    turn: { player: S(1) } as PlayerView['turn'],
  });

  it('classifies the current SBP builder as `sbpBuilder` with the queue', () => {
    const s = turnRuleSituation(sbp, S(2));
    expect(s).toEqual({ kind: 'sbpBuilder', builder: S(2), queue: [S(3), S(4), S(5), S(0)] });
  });

  it('classifies everyone else during SBP as `sbpWaiting` (incl. the seat whose turn just ended)', () => {
    expect(turnRuleSituation(sbp, S(1)).kind).toBe('sbpWaiting'); // the ender
    expect(turnRuleSituation(sbp, S(3)).kind).toBe('sbpWaiting'); // still in queue
    expect(turnRuleSituation(sbp, S(0)).kind).toBe('sbpWaiting');
  });
});

describe('turnRuleSituation — 2022 Paired Players partial turn', () => {
  // Modeled as a restricted `main` turn owned by the paired builder (T-602): turn.player === builder.
  const paired = view({
    phase: { kind: 'main' },
    turn: { player: S(3) } as PlayerView['turn'],
    ext: { fiveSix: { partialTurn: { builder: S(3), resumeFrom: S(0) } } },
  });

  it('classifies the paired builder as `pairedPartial`', () => {
    expect(turnRuleSituation(paired, S(3))).toEqual({
      kind: 'pairedPartial',
      builder: S(3),
      resumeFrom: S(0),
    });
  });

  it('classifies bystanders during a partial turn as `pairedWaiting`', () => {
    expect(turnRuleSituation(paired, S(0)).kind).toBe('pairedWaiting');
    expect(turnRuleSituation(paired, S(5)).kind).toBe('pairedWaiting');
  });

  it('partialTurnMarker reads the whitelisted redact field', () => {
    expect(partialTurnMarker(paired)).toEqual({ builder: S(3), resumeFrom: S(0) });
  });
});

describe('turnRuleSituation — no extra-build rule active', () => {
  it('returns `none` for a normal main turn (no ext, not specialBuild)', () => {
    const normal = view({ phase: { kind: 'main' }, turn: { player: S(0) } as PlayerView['turn'] });
    expect(turnRuleSituation(normal, S(0))).toEqual({ kind: 'none' });
  });

  it('returns `none` when a partial turn marker is present but null', () => {
    const normal = view({
      phase: { kind: 'main' },
      turn: { player: S(0) } as PlayerView['turn'],
      ext: { fiveSix: { partialTurn: null } },
    });
    expect(turnRuleSituation(normal, S(0)).kind).toBe('none');
    expect(partialTurnMarker(normal)).toBeNull();
  });
});
