import { describe, expect, it } from 'vitest';
import * as api from './index.js';

describe('engine public API (docs/02 §4)', () => {
  it('exports ENGINE_VERSION', () => {
    expect(api.ENGINE_VERSION).toBeDefined();
    expect(typeof api.ENGINE_VERSION).toBe('string');
  });

  it('exports the engine surface: createGame, reduce, guards, vp, rng, events', () => {
    expect(typeof api.createGame).toBe('function');
    expect(typeof api.validateConfig).toBe('function');
    expect(typeof api.reduce).toBe('function');
    expect(typeof api.advanceTurn).toBe('function');
    expect(typeof api.handleEndTurn).toBe('function');
    expect(typeof api.requireRolled).toBe('function');
    expect(typeof api.requireMain).toBe('function');
    expect(typeof api.checkWin).toBe('function');
    expect(typeof api.computeVp).toBe('function');
    expect(typeof api.hashSeed).toBe('function');
    expect(typeof api.shuffle).toBe('function');
    expect(typeof api.events.turnEnded).toBe('function');
  });

  it('keeps test-only and internal surfaces out of the index', () => {
    expect('stateWith' in api).toBe(false); // testkit ships via the ./testkit subpath only
    expect('PHASE_HANDLERS' in api).toBe(false); // registration surface stays engine-internal
  });
});
