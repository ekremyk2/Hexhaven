import type { StateCreator } from 'zustand';
import type { LobbySlice, LobbyStateShape, RootState } from './types';

const initialLobbyState: LobbyStateShape = {
  gameId: null,
  code: null,
  hostSeat: null,
  seats: [],
  mySeat: null,
  started: false,
  presence: {},
  lastError: null,
};

export const createLobbySlice: StateCreator<RootState, [], [], LobbySlice> = (set) => ({
  lobby: initialLobbyState,

  applyLobbyState(payload) {
    // T-203 §4: `you` is present only in the message routed back to the seat that just claimed it
    // (create/join) — every other recipient omits it, so `mySeat` must persist across updates that
    // don't include it rather than reset to null. Persisting `you` into localStorage
    // (`hexhaven.session`) is the ws client's job (ws/client.ts), not the store's — reductions here
    // stay side-effect-free, and the hot-seat transport (T-305) never writes network sessions.
    set((state) => ({
      lobby: {
        ...state.lobby,
        gameId: payload.gameId,
        code: payload.code,
        hostSeat: payload.hostSeat,
        seats: payload.seats,
        mySeat: payload.you?.seat ?? state.lobby.mySeat,
        // A `lobby.state` reaching here means create/join/ready/rejoin just succeeded — any
        // earlier inline form error (T-401 requirement 1) no longer applies.
        lastError: null,
      },
    }));
  },

  applyPresence(payload) {
    set((state) => ({
      lobby: {
        ...state.lobby,
        presence: { ...state.lobby.presence, [payload.seat]: payload.connected },
      },
    }));
  },

  setLobbyStarted(started) {
    set((state) => ({ lobby: { ...state.lobby, started } }));
  },

  setLobbyError(error) {
    set((state) => ({ lobby: { ...state.lobby, lastError: error } }));
  },
});
