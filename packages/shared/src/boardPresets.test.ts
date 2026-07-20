// T-607: the board-preset registry (research §C.3/§D). Verifies the picker's menu per mode, that
// only CONFIRMED layouts are selectable, and that scenario presets point at shipped `Scenario`
// records — the availability-honesty contract the picker relies on.
import { describe, expect, it } from 'vitest';
import {
  BOARD_PRESETS,
  boardModeForExpansions,
  boardPresetScenario,
  boardPresetsForMode,
  getBoardPreset,
  isBuildableBoardPresetId,
  isFiveSixOnlyScenario,
} from './boardPresets.js';
import { isScenarioId } from './scenario.js';

describe('boardPresetsForMode', () => {
  it('base mode lists Random + Beginner, both selectable', () => {
    const base = boardPresetsForMode('base');
    expect(base.map((p) => p.id)).toEqual(['random', 'beginner']);
    expect(base.every((p) => p.available)).toBe(true);
    expect(base.find((p) => p.id === 'random')?.kind).toBe('random');
    expect(base.find((p) => p.id === 'beginner')?.kind).toBe('fixed');
  });

  it('fiveSix mode lists Random (selectable) + the 5-6 fixed board (coming soon)', () => {
    const five = boardPresetsForMode('fiveSix');
    expect(five.map((p) => p.id)).toEqual(['random', 'fiveSixNewPlayers']);
    expect(getBoardPreset('fiveSix', 'random')?.available).toBe(true);
    expect(getBoardPreset('fiveSix', 'fiveSixNewPlayers')?.available).toBe(false);
    expect(five.every((p) => p.players.every((n) => n >= 5))).toBe(true);
  });

  it('seafarers mode lists scenario presets pointing at a Scenario, with the intro one available', () => {
    const sf = boardPresetsForMode('seafarers');
    expect(sf.length).toBeGreaterThan(0);
    for (const preset of sf) {
      expect(preset.kind).toBe('scenario');
      expect(preset.scenarioId).toBeDefined();
      expect(isScenarioId(preset.scenarioId!)).toBe(true);
      expect(boardPresetScenario(preset)).toBe(preset.scenarioId);
    }
    // T-705: "Heading for New Shores" is shipped and selectable now.
    expect(getBoardPreset('seafarers', 'headingForNewShores')?.available).toBe(true);
    // T-752: "New World" is shipped, selectable, and 5-6-only.
    expect(getBoardPreset('seafarers', 'newWorld')?.available).toBe(true);
    expect(getBoardPreset('seafarers', 'newWorld')?.players).toEqual([5, 6]);
    // T-753: "Through the Desert" is shipped, selectable, and 5-6-only too.
    expect(getBoardPreset('seafarers', 'throughTheDesert')?.available).toBe(true);
    expect(getBoardPreset('seafarers', 'throughTheDesert')?.players).toEqual([5, 6]);
    // T-754: "The Forgotten Tribe" is shipped, selectable, and 5-6-only too.
    expect(getBoardPreset('seafarers', 'forgottenTribe')?.available).toBe(true);
    expect(getBoardPreset('seafarers', 'forgottenTribe')?.players).toEqual([5, 6]);
    // T-755: "The Six Islands" is shipped, selectable, and 5-6-only too.
    expect(getBoardPreset('seafarers', 'sixIslands')?.available).toBe(true);
    expect(getBoardPreset('seafarers', 'sixIslands')?.players).toEqual([5, 6]);
    // T-756: "The Fog Islands" is shipped, selectable, and 5-6-only too.
    expect(getBoardPreset('seafarers', 'fogIslands')?.available).toBe(true);
    expect(getBoardPreset('seafarers', 'fogIslands')?.players).toEqual([5, 6]);
    // T-757: "Cloth for Hexhaven" is shipped, selectable, and 5-6-only too.
    expect(getBoardPreset('seafarers', 'clothForHexhaven')?.available).toBe(true);
    expect(getBoardPreset('seafarers', 'clothForHexhaven')?.players).toEqual([5, 6]);
    // T-758: "The Pirate Islands" is shipped, selectable, and 5-6-only too.
    expect(getBoardPreset('seafarers', 'pirateIslands')?.available).toBe(true);
    expect(getBoardPreset('seafarers', 'pirateIslands')?.players).toEqual([5, 6]);
    // T-759: "The Wonders of Hexhaven" is shipped, selectable, and 5-6-only too.
    expect(getBoardPreset('seafarers', 'wondersOfHexhaven')?.available).toBe(true);
    expect(getBoardPreset('seafarers', 'wondersOfHexhaven')?.players).toEqual([5, 6]);
  });
});

describe('boardPresetsForMode player-count filtering (T-752/T-753/T-754 — 5-6-only scenario picker gating)', () => {
  it('hides the 5-6-only scenarios at 3 and 4 players, keeps "Heading for New Shores" offered everywhere', () => {
    for (const pc of [3, 4] as const) {
      const ids = boardPresetsForMode('seafarers', pc).map((p) => p.id);
      expect(ids).not.toContain('newWorld');
      expect(ids).not.toContain('throughTheDesert');
      expect(ids).not.toContain('forgottenTribe');
      expect(ids).not.toContain('sixIslands');
      expect(ids).not.toContain('fogIslands');
      expect(ids).not.toContain('clothForHexhaven');
      expect(ids).not.toContain('pirateIslands');
      expect(ids).not.toContain('wondersOfHexhaven');
      expect(ids).toContain('headingForNewShores');
    }
  });

  it('shows the 5-6-only scenarios at 5 and 6 players, alongside "Heading for New Shores"', () => {
    for (const pc of [5, 6] as const) {
      const ids = boardPresetsForMode('seafarers', pc).map((p) => p.id);
      expect(ids).toContain('newWorld');
      expect(ids).toContain('throughTheDesert');
      expect(ids).toContain('forgottenTribe');
      expect(ids).toContain('sixIslands');
      expect(ids).toContain('fogIslands');
      expect(ids).toContain('clothForHexhaven');
      expect(ids).toContain('pirateIslands');
      expect(ids).toContain('wondersOfHexhaven');
      expect(ids).toContain('headingForNewShores');
    }
  });

  it('omitting playerCount keeps the old unfiltered (mode-only) behaviour', () => {
    const ids = boardPresetsForMode('seafarers').map((p) => p.id);
    expect(ids).toContain('newWorld');
    expect(ids).toContain('throughTheDesert');
    expect(ids).toContain('forgottenTribe');
    expect(ids).toContain('sixIslands');
    expect(ids).toContain('fogIslands');
    expect(ids).toContain('clothForHexhaven');
    expect(ids).toContain('pirateIslands');
    expect(ids).toContain('wondersOfHexhaven');
    expect(ids).toContain('headingForNewShores');
  });
});

describe('isFiveSixOnlyScenario', () => {
  it('is true for "New World" (players: [5, 6])', () => {
    expect(isFiveSixOnlyScenario('newWorld')).toBe(true);
  });

  it('is true for "Through the Desert" (players: [5, 6])', () => {
    expect(isFiveSixOnlyScenario('throughTheDesert')).toBe(true);
  });

  it('is true for "The Forgotten Tribe" (players: [5, 6])', () => {
    expect(isFiveSixOnlyScenario('forgottenTribe')).toBe(true);
  });

  it('is true for "The Six Islands" (players: [5, 6])', () => {
    expect(isFiveSixOnlyScenario('sixIslands')).toBe(true);
  });

  it('is true for "The Fog Islands" (players: [5, 6])', () => {
    expect(isFiveSixOnlyScenario('fogIslands')).toBe(true);
  });

  it('is true for "Cloth for Hexhaven" (players: [5, 6])', () => {
    expect(isFiveSixOnlyScenario('clothForHexhaven')).toBe(true);
  });

  it('is true for "The Pirate Islands" (players: [5, 6])', () => {
    expect(isFiveSixOnlyScenario('pirateIslands')).toBe(true);
  });

  it('is true for "The Wonders of Hexhaven" (players: [5, 6])', () => {
    expect(isFiveSixOnlyScenario('wondersOfHexhaven')).toBe(true);
  });

  it('is false for "Heading for New Shores" (players: [3, 4, 5, 6])', () => {
    expect(isFiveSixOnlyScenario('headingForNewShores')).toBe(false);
  });

  it('is false for an unknown scenario id (gate closed, mirrors isScenarioId)', () => {
    expect(isFiveSixOnlyScenario('atlantis')).toBe(false);
  });
});

describe('boardModeForExpansions', () => {
  it('maps the expansion toggles to a mode (seafarers > fiveSix > base)', () => {
    expect(boardModeForExpansions({ fiveSix: false, seafarers: false, citiesKnights: false })).toBe('base');
    expect(boardModeForExpansions({ fiveSix: true, seafarers: false, citiesKnights: false })).toBe('fiveSix');
    expect(boardModeForExpansions({ fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false })).toBe(
      'seafarers',
    );
  });
});

describe('isBuildableBoardPresetId (wire/server gate)', () => {
  it('accepts only the ids the engine can build today', () => {
    expect(isBuildableBoardPresetId('random')).toBe(true);
    expect(isBuildableBoardPresetId('beginner')).toBe(true);
  });

  it('rejects catalog-only ("coming soon") preset ids', () => {
    expect(isBuildableBoardPresetId('fiveSixNewPlayers')).toBe(false);
    expect(isBuildableBoardPresetId('headingForNewShores')).toBe(false);
    expect(isBuildableBoardPresetId('nonsense')).toBe(false);
  });

  it('rejects "newWorld" too — every scenario preset rides expansions.seafarers.scenario, never config.board', () => {
    expect(isBuildableBoardPresetId('newWorld')).toBe(false);
  });

  it('rejects "throughTheDesert" too — same reason', () => {
    expect(isBuildableBoardPresetId('throughTheDesert')).toBe(false);
  });

  it('rejects "forgottenTribe" too — same reason', () => {
    expect(isBuildableBoardPresetId('forgottenTribe')).toBe(false);
  });

  it('rejects "sixIslands" too — same reason', () => {
    expect(isBuildableBoardPresetId('sixIslands')).toBe(false);
  });

  it('rejects "fogIslands" too — same reason', () => {
    expect(isBuildableBoardPresetId('fogIslands')).toBe(false);
  });

  it('rejects "clothForHexhaven" too — same reason', () => {
    expect(isBuildableBoardPresetId('clothForHexhaven')).toBe(false);
  });

  it('rejects "pirateIslands" too — same reason', () => {
    expect(isBuildableBoardPresetId('pirateIslands')).toBe(false);
  });

  it('rejects "wondersOfHexhaven" too — same reason', () => {
    expect(isBuildableBoardPresetId('wondersOfHexhaven')).toBe(false);
  });
});

describe('registry integrity', () => {
  it('every preset carries non-empty, namespace-qualified i18n keys', () => {
    for (const preset of BOARD_PRESETS) {
      expect(preset.labelKey).toMatch(/^lobby:/);
      expect(preset.descriptionKey).toMatch(/^lobby:/);
    }
  });

  it('preset ids are unique within a mode', () => {
    const seen = new Set<string>();
    for (const preset of BOARD_PRESETS) {
      const key = `${preset.mode}:${preset.id}`;
      expect(seen.has(key), `duplicate ${key}`).toBe(false);
      seen.add(key);
    }
  });

  it('only random/fixed presets are ever buildable; scenario presets never cross the config.board wire', () => {
    // A scenario preset may be `available` (selectable, T-705) yet must never be a `config.board`
    // value — the scenario id rides `expansions.seafarers.scenario` instead (see OptionsPanel).
    for (const preset of BOARD_PRESETS) {
      if (preset.kind === 'scenario') expect(isBuildableBoardPresetId(preset.id)).toBe(false);
    }
  });
});
