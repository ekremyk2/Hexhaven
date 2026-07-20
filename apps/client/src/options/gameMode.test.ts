// Unit tests for the game-mode helpers behind the GameModeDialog (the "PUBG menu"). These are thin
// relayers over the tested `withExpansionToggled`/`withScenario`/`withPlayerCount` logic, so this
// pins the mode<->expansion mapping + the C&K add-on availability rule, not the combination guard.
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM_CONFIG, GAME_MODES, gameModeSummary, isCkAddonAvailable, isCkAddonOn, selectedGameMode, withCkAddon, withGameMode } from './OptionsPanel';

describe('game-mode helpers (GameModeDialog)', () => {
  it('offers exactly the four mutually-exclusive board worlds (C&K is an add-on, not a world)', () => {
    expect([...GAME_MODES]).toEqual(['base', 'seafarers', 'tradersBarbarians', 'explorersPirates']);
  });

  it('a fresh config is the base world', () => {
    expect(selectedGameMode(DEFAULT_ROOM_CONFIG)).toBe('base');
  });

  it('round-trips each board world through selectedGameMode', () => {
    for (const mode of GAME_MODES) {
      expect(selectedGameMode(withGameMode(DEFAULT_ROOM_CONFIG, mode))).toBe(mode);
    }
  });

  it('switching to a standalone world (T&B/E&P) clears a C&K add-on', () => {
    const withCk = withCkAddon(withGameMode(DEFAULT_ROOM_CONFIG, 'base'), true);
    expect(isCkAddonOn(withCk)).toBe(true);
    const tb = withGameMode(withCk, 'tradersBarbarians');
    expect(selectedGameMode(tb)).toBe('tradersBarbarians');
    expect(isCkAddonOn(tb)).toBe(false);
  });

  it('C&K add-on is available on base + Seafarers, not on T&B/E&P', () => {
    expect(isCkAddonAvailable(withGameMode(DEFAULT_ROOM_CONFIG, 'base'))).toBe(true);
    expect(isCkAddonAvailable(withGameMode(DEFAULT_ROOM_CONFIG, 'seafarers'))).toBe(true);
    expect(isCkAddonAvailable(withGameMode(DEFAULT_ROOM_CONFIG, 'tradersBarbarians'))).toBe(false);
    expect(isCkAddonAvailable(withGameMode(DEFAULT_ROOM_CONFIG, 'explorersPirates'))).toBe(false);
  });

  it('gameModeSummary names the world + its selected scenario', () => {
    const base = gameModeSummary(withGameMode(DEFAULT_ROOM_CONFIG, 'base'));
    expect(base.nameKey).toBe('lobby:options.gameMode.base.name');

    const sea = gameModeSummary(withGameMode(DEFAULT_ROOM_CONFIG, 'seafarers'));
    expect(sea.nameKey).toBe('lobby:options.expansions.seafarers.name');
    expect(sea.detailKey).toBeTruthy(); // the scenario's board-preset label

    const ep = gameModeSummary(withGameMode(DEFAULT_ROOM_CONFIG, 'explorersPirates'));
    expect(ep.nameKey).toBe('lobby:options.expansions.explorersPirates.name');
  });
});
