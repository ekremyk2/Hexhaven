// B-40: the "Special plays" panel lists a combo only when the viewer HOLDS its component base cards
// (playtest: "show Ride by Night only if I have Knight and Road Building"). `comboComponentsHeld` is
// that ownership gate — the rest of `computeComboPlayState` (turn/phase/target) is exercised via the
// panel's live behavior; this locks the visibility rule per combo.
import { describe, expect, it } from 'vitest';
import type { OwnPlayerView } from '@hexhaven/engine';
import type { DevCardType, Seat } from '@hexhaven/shared';
import { comboComponentsHeld } from './cardModLogic';

function own(...types: DevCardType[]): OwnPlayerView {
  return {
    seat: 0 as Seat,
    devCards: types.map((type) => ({ type, boughtOnTurn: 0 })),
  } as unknown as OwnPlayerView;
}

describe('comboComponentsHeld (B-40 combo visibility gate)', () => {
  it('Ride by Night: needs a Knight AND a Road Building', () => {
    expect(comboComponentsHeld(own('knight', 'roadBuilding'), 'rideByNight')).toBe(true);
    expect(comboComponentsHeld(own('knight'), 'rideByNight')).toBe(false);
    expect(comboComponentsHeld(own('roadBuilding'), 'rideByNight')).toBe(false);
    expect(comboComponentsHeld(own(), 'rideByNight')).toBe(false);
  });

  it('Mega Knight: needs TWO knights (one is not enough)', () => {
    expect(comboComponentsHeld(own('knight', 'knight'), 'megaKnight')).toBe(true);
    expect(comboComponentsHeld(own('knight'), 'megaKnight')).toBe(false);
  });

  it('Night of Plenty (Knight+YearOfPlenty), Monorail (Monopoly+RoadBuilding), Super Settle (VP card)', () => {
    expect(comboComponentsHeld(own('knight', 'yearOfPlenty'), 'nightOfPlenty')).toBe(true);
    expect(comboComponentsHeld(own('knight'), 'nightOfPlenty')).toBe(false);
    expect(comboComponentsHeld(own('monopoly', 'roadBuilding'), 'monorail')).toBe(true);
    expect(comboComponentsHeld(own('roadBuilding'), 'monorail')).toBe(false);
    expect(comboComponentsHeld(own('victoryPoint'), 'superSettle')).toBe(true);
    expect(comboComponentsHeld(own(), 'superSettle')).toBe(false);
  });
});
