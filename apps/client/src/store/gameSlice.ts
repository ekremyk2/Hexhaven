import type { StateCreator } from 'zustand';
import type { GameSlice, GameStateShape, RootState } from './types';

const initialGameState: GameStateShape = {
  view: null,
  uiMode: 'idle',
  shipMoveFrom: null,
  knightPickFrom: null,
  hexPieceTarget: null,
  progressCardStep1: null,
  events: [],
  deadlines: [],
};

export const createGameSlice: StateCreator<RootState, [], [], GameSlice> = (set) => ({
  game: initialGameState,

  applyGameStarted(view) {
    set({
      game: {
        view,
        uiMode: 'idle',
        shipMoveFrom: null,
        knightPickFrom: null,
        hexPieceTarget: null,
        progressCardStep1: null,
        events: [],
        deadlines: [],
      },
    });
  },

  applyGameEvents(payload) {
    set((state) => ({
      game: {
        ...state.game,
        // T-301 §5 decision: the server's `game.events` carries a fresh `PlayerView` alongside the
        // events, applied wholesale — the client never reconstructs a view from event deltas.
        view: payload.view ?? state.game.view,
        events: [...state.game.events, ...payload.events],
      },
    }));
  },

  applyGameSync(view) {
    set((state) => ({
      game: {
        ...state.game,
        view,
        uiMode: 'idle',
        shipMoveFrom: null,
        knightPickFrom: null,
        hexPieceTarget: null,
        progressCardStep1: null,
      },
    }));
  },

  setUiMode(mode) {
    // Any mode change resets the pending move-ship source edge / knight-pick source vertex / armed
    // hex-piece kind / progress-card first pick — entering a two-step mode (or a chooser) starts
    // fresh (awaiting the step-1 pick), and leaving one drops a half-finished selection (T-705/
    // T-806/T-903/Phase-9 board-click targeting).
    set((state) => ({
      game: {
        ...state.game,
        uiMode: mode,
        shipMoveFrom: null,
        knightPickFrom: null,
        hexPieceTarget: null,
        progressCardStep1: null,
      },
    }));
  },

  setShipMoveFrom(edge) {
    set((state) => ({ game: { ...state.game, shipMoveFrom: edge } }));
  },

  setKnightPickFrom(vertex) {
    set((state) => ({ game: { ...state.game, knightPickFrom: vertex } }));
  },

  setHexPieceTarget(kind) {
    set((state) => ({ game: { ...state.game, hexPieceTarget: kind } }));
  },

  setProgressCardStep1(id) {
    set((state) => ({ game: { ...state.game, progressCardStep1: id } }));
  },

  applyTimers(payload) {
    set((state) => ({ game: { ...state.game, deadlines: payload.deadlines } }));
  },
});
