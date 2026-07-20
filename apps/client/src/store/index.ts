// The combined store (T-301 §2): zustand's "slices pattern" — each slice owns one concern, this
// module wires them together, adds the inbound-message dispatcher (§5) and the outbound-intent
// wrappers (§3), and exports typed selector hooks. Components only ever import from here — never
// from an individual slice file, `store/transport.ts`, or `ws/client.ts` directly.
import { create } from 'zustand';
import type { ServerMessage } from '@hexhaven/shared';
import { createChatSlice } from './chatSlice';
import { createConnectionSlice } from './connectionSlice';
import { createGameSlice } from './gameSlice';
import { createLobbySlice } from './lobbySlice';
import { createToastSlice } from './toastSlice';
import { getTransport } from './transport';
import { clearSession } from '../ws/session';
import type { RootState } from './types';

// T-401 requirement 1: `game.error` codes that only ever happen in reply to `lobby.create`/
// `lobby.join` (docs/02 §5) render as an inline field error on the Home screen, never a toast —
// every other engine/protocol error code keeps going to the toast queue (store/toastSlice.ts).
const LOBBY_FLOW_ERROR_CODES = new Set<string>([
  'UNKNOWN_GAME',
  'LOBBY_FULL',
  'ALREADY_STARTED',
  'NICKNAME_TAKEN',
  'PASSWORD_REQUIRED',
  'BAD_PASSWORD',
  'EXPANSION_NOT_AVAILABLE',
  // T-901 (docs/07 D-034): an incompatible `config.modifiers` combination is rejected at
  // `lobby.create` time exactly like an unshipped expansion — same inline-field-error treatment.
  'MODIFIER_INCOMPATIBLE',
]);

/** Builds a fresh, independent store instance. Tests use this for isolation; the app uses the
 * singleton `useStore` below. */
export function createRootStore() {
  return create<RootState>()((set, get, api) => ({
    ...createConnectionSlice(set, get, api),
    ...createLobbySlice(set, get, api),
    ...createGameSlice(set, get, api),
    ...createChatSlice(set, get, api),
    ...createToastSlice(set, get, api),

    applyServerMessage(msg: ServerMessage) {
      const state = get();
      switch (msg.type) {
        case 'lobby.state':
          state.applyLobbyState(msg.payload);
          return;
        case 'game.started':
          // Cross-slice orchestration lives here (the dispatcher), not inside a single slice
          // reaching into another slice's actions.
          state.applyGameStarted(msg.payload);
          state.setLobbyStarted(true);
          // A game (re)starting clears any leftover toasts from a previous game — notably a rematch,
          // which reuses the same route/session, so stale toasts would otherwise linger/replay.
          set({ toasts: [] });
          return;
        case 'game.events':
          state.applyGameEvents(msg.payload);
          return;
        case 'game.sync':
          state.applyGameSync(msg.payload);
          return;
        case 'game.error':
          if (LOBBY_FLOW_ERROR_CODES.has(msg.payload.code)) {
            state.setLobbyError({ code: msg.payload.code, message: msg.payload.message });
          } else {
            state.pushToast({ kind: 'error', message: msg.payload.message, code: msg.payload.code });
          }
          return;
        case 'chat.message':
          state.addChatMessage(msg.payload);
          return;
        case 'presence':
          state.applyPresence(msg.payload);
          return;
        case 'timer':
          state.applyTimers(msg.payload);
          return;
        default: {
          // Exhaustiveness guard (matches actions.ts's Equal/Expect drift-guard style): a new
          // ServerMessage variant added without a case here fails `pnpm -w typecheck`.
          const exhaustiveCheck: never = msg;
          return exhaustiveCheck;
        }
      }
    },

    sendAction(action) {
      getTransport()?.send(action);
    },
    sendLobbyMessage(msg) {
      getTransport()?.sendLobby(msg);
    },
    sendChatMessage(text) {
      getTransport()?.sendChat(text);
    },

    leaveGame() {
      // Clear the persisted session first so the next socket open won't auto-rejoin the game we're
      // leaving (that was the "new game threw me back to the finished one + replayed toasts" bug).
      clearSession();
      set({
        game: {
          view: null,
          uiMode: 'idle',
          shipMoveFrom: null,
          knightPickFrom: null,
          hexPieceTarget: null,
          progressCardStep1: null,
          events: [],
          deadlines: [],
        },
        lobby: {
          gameId: null,
          code: null,
          hostSeat: null,
          seats: [],
          mySeat: null,
          started: false,
          presence: {},
          lastError: null,
        },
        chat: { messages: [] },
        toasts: [],
      });
    },
  }));
}

export const useStore = createRootStore();

// ---- Typed selectors (T-301 §2: "selectors typed; no component reads raw ws") -----------------
export const useConnectionStatus = () => useStore((s) => s.connection.status);
export const useLobbyState = () => useStore((s) => s.lobby);
export const useGameView = () => useStore((s) => s.game.view);
export const useUiMode = () => useStore((s) => s.game.uiMode);
export const useShipMoveFrom = () => useStore((s) => s.game.shipMoveFrom);
export const useKnightPickFrom = () => useStore((s) => s.game.knightPickFrom);
export const useHexPieceTarget = () => useStore((s) => s.game.hexPieceTarget);
export const useProgressCardStep1 = () => useStore((s) => s.game.progressCardStep1);
export const useGameEvents = () => useStore((s) => s.game.events);
export const useChatMessages = () => useStore((s) => s.chat.messages);
export const useToasts = () => useStore((s) => s.toasts);

export type { RootState } from './types';
