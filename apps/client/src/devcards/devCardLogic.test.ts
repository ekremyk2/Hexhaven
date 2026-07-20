import { describe, expect, it } from 'vitest';
import type { GameState, Seat } from '@hexhaven/shared';
import {
  computeDevPlayState,
  computeRoadBuildingBanner,
  groupDevCards,
  resolveRoadBuildingCount,
  resolveYearOfPlentyCount,
  yopCanConfirm,
  yopFirstPickDisabled,
  yopSecondPickDisabled,
} from './devCardLogic';
import { asView, craft, devCard, SEAT0, SEAT1 } from './testHelpers';

const ZERO_BANK: GameState['bank'] = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };

describe('computeDevPlayState (task requirement 1: the disabled-reason matrix)', () => {
  it('"Not your turn" when the viewer is not the turn owner, even if they hold a playable card', () => {
    const state = craft({ devCards: [devCard('knight', 1)] }, { turn: { number: 5, player: SEAT1, rolled: true, roll: null, devPlayed: false } });
    const view = asView(state);
    expect(computeDevPlayState(view, SEAT0, 'knight')).toEqual({ playable: false, reason: 'notYourTurn' });
  });

  it('"Not available right now" outside preRoll/main even on the viewer\'s own turn', () => {
    const state = craft(
      { devCards: [devCard('knight', 1)] },
      { phase: { kind: 'discard', pending: [], amounts: {} as Record<Seat, number> } },
    );
    const view = asView(state);
    expect(computeDevPlayState(view, SEAT0, 'knight')).toEqual({ playable: false, reason: 'wrongPhase' });
  });

  it('preRoll plays work (R4.1) — playable in preRoll exactly like main', () => {
    const state = craft(
      { devCards: [devCard('knight', 1)] },
      { phase: { kind: 'preRoll' }, turn: { number: 5, player: SEAT0, rolled: false, roll: null, devPlayed: false } },
    );
    const view = asView(state);
    expect(computeDevPlayState(view, SEAT0, 'knight')).toEqual({ playable: true });
  });

  it('"You don\'t hold this card" when the type isn\'t in hand at all', () => {
    const state = craft({ devCards: [] });
    const view = asView(state);
    expect(computeDevPlayState(view, SEAT0, 'monopoly')).toEqual({ playable: false, reason: 'cardNotHeld' });
  });

  it('"Already played a card this turn" (R9.3) when turn.devPlayed is true', () => {
    const state = craft(
      { devCards: [devCard('knight', 1)] },
      { turn: { number: 5, player: SEAT0, rolled: true, roll: [3, 4], devPlayed: true } },
    );
    const view = asView(state);
    expect(computeDevPlayState(view, SEAT0, 'knight')).toEqual({ playable: false, reason: 'alreadyPlayed' });
  });

  it('"Bought this turn" (R9.4) when the only held copy was bought THIS turn', () => {
    const state = craft(
      { devCards: [devCard('monopoly', 5)] },
      { turn: { number: 5, player: SEAT0, rolled: true, roll: [3, 4], devPlayed: false } },
    );
    const view = asView(state);
    expect(computeDevPlayState(view, SEAT0, 'monopoly')).toEqual({ playable: false, reason: 'boughtThisTurn' });
  });

  it('an OLDER copy of the same type stays playable even if a NEW copy was also bought this turn', () => {
    const state = craft(
      { devCards: [devCard('monopoly', 2), devCard('monopoly', 5)] },
      { turn: { number: 5, player: SEAT0, rolled: true, roll: [3, 4], devPlayed: false } },
    );
    const view = asView(state);
    expect(computeDevPlayState(view, SEAT0, 'monopoly')).toEqual({ playable: true });
  });

  it('"No road pieces, or nowhere legal to build" (ER-5) when Road Building has 0 road pieces left', () => {
    const state = craft({ devCards: [devCard('roadBuilding', 0)], piecesLeft: { roads: 0, settlements: 5, cities: 4 } });
    const view = asView(state);
    expect(computeDevPlayState(view, SEAT0, 'roadBuilding')).toEqual({ playable: false, reason: 'cannotPlay' });
  });

  it('"Bank is empty" (ER-6) when Year of Plenty has nothing left in the bank', () => {
    const state = craft({ devCards: [devCard('yearOfPlenty', 0)] }, { bank: ZERO_BANK });
    const view = asView(state);
    expect(computeDevPlayState(view, SEAT0, 'yearOfPlenty')).toEqual({ playable: false, reason: 'bankEmpty' });
  });
});

describe('groupDevCards (own hand grouped by type, DISPLAY_ORDER regardless of input order)', () => {
  it('returns an empty list for an empty hand', () => {
    expect(groupDevCards({ devCards: [] }, 5)).toEqual([]);
  });

  it('groups by type with counts, ordered knight/roadBuilding/yearOfPlenty/monopoly/victoryPoint', () => {
    const own = {
      devCards: [devCard('victoryPoint', 1), devCard('monopoly', 2), devCard('knight', 1), devCard('knight', 3)],
    };
    const groups = groupDevCards(own, 5);
    expect(groups.map((g) => g.type)).toEqual(['knight', 'monopoly', 'victoryPoint']);
    expect(groups.find((g) => g.type === 'knight')?.count).toBe(2);
  });

  it('isNew is true only when EVERY held copy of that type was bought this turn', () => {
    const mixed = groupDevCards({ devCards: [devCard('knight', 2), devCard('knight', 5)] }, 5);
    expect(mixed[0]?.isNew).toBe(false);

    const allNew = groupDevCards({ devCards: [devCard('knight', 5), devCard('knight', 5)] }, 5);
    expect(allNew[0]?.isNew).toBe(true);
  });
});

describe('computeRoadBuildingBanner (task requirement 3)', () => {
  it('null outside the roadBuilding phase', () => {
    const view = asView(craft());
    expect(computeRoadBuildingBanner(view, SEAT0)).toBeNull();
  });

  it("null when it isn't the viewer's own free-road decision", () => {
    const state = craft({}, { phase: { kind: 'roadBuilding', remaining: 2 }, turn: { number: 5, player: SEAT1, rolled: true, roll: null, devPlayed: true } });
    const view = asView(state, SEAT0);
    expect(computeRoadBuildingBanner(view, SEAT0)).toBeNull();
  });

  it('reflects phase.remaining (2, then 1) for the mover', () => {
    const state2 = craft({}, { phase: { kind: 'roadBuilding', remaining: 2 }, turn: { number: 5, player: SEAT0, rolled: true, roll: null, devPlayed: true } });
    expect(computeRoadBuildingBanner(asView(state2), SEAT0)).toEqual({ remaining: 2 });

    const state1 = craft({}, { phase: { kind: 'roadBuilding', remaining: 1 }, turn: { number: 5, player: SEAT0, rolled: true, roll: null, devPlayed: true } });
    expect(computeRoadBuildingBanner(asView(state1), SEAT0)).toEqual({ remaining: 1 });
  });
});

describe('Year of Plenty bank-gating helpers (ER-6, task requirement 4)', () => {
  const bank = { brick: 0, lumber: 1, wool: 2, grain: 5, ore: 0 };

  it('first pick disabled only when the bank holds none of it', () => {
    expect(yopFirstPickDisabled(bank, 'brick')).toBe(true);
    expect(yopFirstPickDisabled(bank, 'lumber')).toBe(false);
  });

  it('second pick of the SAME type needs 2 in the bank, not 1', () => {
    expect(yopSecondPickDisabled(bank, 'lumber', 'lumber')).toBe(true); // only 1 lumber total
    expect(yopSecondPickDisabled(bank, 'wool', 'wool')).toBe(false); // 2 wool available
  });

  it('second pick of a DIFFERENT type only needs 1', () => {
    expect(yopSecondPickDisabled(bank, 'lumber', 'wool')).toBe(false);
    expect(yopSecondPickDisabled(bank, 'lumber', 'brick')).toBe(true); // bank has 0 brick
  });

  it('confirm requires both picks made and the bank able to supply both', () => {
    expect(yopCanConfirm(bank, null, 'wool')).toBe(false);
    expect(yopCanConfirm(bank, 'wool', 'wool')).toBe(true);
    expect(yopCanConfirm(bank, 'lumber', 'lumber')).toBe(false); // needs 2, bank has 1
  });
});

describe('resolve{RoadBuilding,YearOfPlenty}Count reflect customConstants (B-43: card info updates with modifiers)', () => {
  it('default (no modifier): both resolve to the base 2', () => {
    const view = asView(craft());
    expect(resolveRoadBuildingCount(view)).toBe(2);
    expect(resolveYearOfPlentyCount(view)).toBe(2);
  });

  it('customConstants overrides drive the resolved counts (so the card descriptions stay honest)', () => {
    const base = craft();
    const view = asView({
      ...base,
      config: { ...base.config, modifiers: { customConstants: { roadBuildingCount: 4, yearOfPlentyCount: 3 } } },
    });
    expect(resolveRoadBuildingCount(view)).toBe(4);
    expect(resolveYearOfPlentyCount(view)).toBe(3);
  });
});
