// Store reduction tests (T-301 §7): scripted server-message sequences — parsed through the real
// `ServerMessageSchema`, exactly like the transport delivers them — reduced via
// `applyServerMessage`, plus outbound-intent forwarding through a mock `GameTransport`.
import { afterEach, describe, expect, it } from 'vitest';
import { ServerMessageSchema, type Action, type ServerMessage } from '@hexhaven/shared';
import { DEFAULT_ROOM_CONFIG } from '../options/OptionsPanel';
import { buildCreatePayload } from '../routes/lobbyForms';
import { createRootStore } from './index';
import { setTransport, type GameTransport, type LobbyOutboundMessage } from './transport';

/** Parses a raw frame with the real wire schema so tests can't drift from the protocol. */
function msg(raw: unknown): ServerMessage {
  return ServerMessageSchema.parse(raw);
}

const lobbyStateWithYou = msg({
  v: 1,
  type: 'lobby.state',
  payload: {
    gameId: 'g1',
    code: 'A2B3C',
    hostSeat: 0,
    seats: [{ occupant: 'human', nickname: 'Alice', ready: true }, { occupant: 'human', nickname: 'Bob', ready: false }, null, null],
    you: { seat: 1, playerToken: 'tok-bob' },
  },
});

const lobbyStateWithoutYou = msg({
  v: 1,
  type: 'lobby.state',
  payload: {
    gameId: 'g1',
    code: 'A2B3C',
    hostSeat: 0,
    seats: [{ occupant: 'human', nickname: 'Alice', ready: true }, { occupant: 'human', nickname: 'Bob', ready: true }, null, null],
  },
});

afterEach(() => {
  setTransport(null);
});

describe('applyServerMessage: lobby.state', () => {
  it('populates the lobby slice and captures mySeat from `you`', () => {
    const store = createRootStore();
    store.getState().applyServerMessage(lobbyStateWithYou);

    const { lobby } = store.getState();
    expect(lobby.gameId).toBe('g1');
    expect(lobby.code).toBe('A2B3C');
    expect(lobby.hostSeat).toBe(0);
    expect(lobby.seats).toHaveLength(4);
    expect(lobby.seats[0]).toEqual({ occupant: 'human', nickname: 'Alice', ready: true });
    expect(lobby.mySeat).toBe(1);
    expect(lobby.started).toBe(false);
  });

  it('preserves mySeat across later lobby.state updates without `you` (T-203 §4)', () => {
    const store = createRootStore();
    store.getState().applyServerMessage(lobbyStateWithYou);
    store.getState().applyServerMessage(lobbyStateWithoutYou);

    const { lobby } = store.getState();
    expect(lobby.mySeat).toBe(1);
    expect(lobby.seats[1]).toEqual({ occupant: 'human', nickname: 'Bob', ready: true });
  });
});

describe('applyServerMessage: game lifecycle', () => {
  const startedView = { me: 1, stateVersion: 0, phase: { kind: 'setup' } };

  it('game.started stores the initial view, resets events/uiMode, and flips lobby.started', () => {
    const store = createRootStore();
    store.getState().applyServerMessage(lobbyStateWithYou);
    store.getState().setUiMode('placingRoad');
    store.getState().applyServerMessage(msg({ v: 1, type: 'game.started', payload: startedView }));

    const { game, lobby } = store.getState();
    expect(game.view).toEqual(startedView);
    expect(game.events).toEqual([]);
    expect(game.uiMode).toBe('idle');
    expect(lobby.started).toBe(true);
  });

  it('game.events appends to the log and applies the fresh view from the payload (T-301 §5)', () => {
    const store = createRootStore();
    store.getState().applyServerMessage(msg({ v: 1, type: 'game.started', payload: startedView }));

    const eventsA = [{ type: 'diceRolled', seat: 1, roll: [3, 4] }];
    const viewA = { me: 1, stateVersion: 1 };
    store.getState().applyServerMessage(
      msg({ v: 1, type: 'game.events', payload: { events: eventsA, stateVersion: 1, view: viewA } }),
    );

    const eventsB = [{ type: 'turnEnded', seat: 1, next: 2 }];
    const viewB = { me: 1, stateVersion: 2 };
    store.getState().applyServerMessage(
      msg({ v: 1, type: 'game.events', payload: { events: eventsB, stateVersion: 2, view: viewB } }),
    );

    const { game } = store.getState();
    expect(game.events).toEqual([...eventsA, ...eventsB]);
    expect(game.view).toEqual(viewB);
  });

  it('game.events without a view keeps the previous view', () => {
    const store = createRootStore();
    store.getState().applyServerMessage(msg({ v: 1, type: 'game.started', payload: startedView }));
    store.getState().applyServerMessage(
      msg({ v: 1, type: 'game.events', payload: { events: [{ type: 'tradeCancelled' }], stateVersion: 1 } }),
    );

    const { game } = store.getState();
    expect(game.view).toEqual(startedView);
    expect(game.events).toHaveLength(1);
  });

  it('game.sync replaces the view wholesale and resets uiMode, keeping the event log', () => {
    const store = createRootStore();
    store.getState().applyServerMessage(msg({ v: 1, type: 'game.started', payload: startedView }));
    store.getState().applyServerMessage(
      msg({ v: 1, type: 'game.events', payload: { events: [{ type: 'tradeCancelled' }], stateVersion: 1 } }),
    );
    store.getState().setUiMode('movingRobber');

    const syncedView = { me: 1, stateVersion: 9 };
    store.getState().applyServerMessage(msg({ v: 1, type: 'game.sync', payload: syncedView }));

    const { game } = store.getState();
    expect(game.view).toEqual(syncedView);
    expect(game.uiMode).toBe('idle');
    expect(game.events).toHaveLength(1);
  });

  it('setUiMode drives the uiMode union', () => {
    const store = createRootStore();
    expect(store.getState().game.uiMode).toBe('idle');
    store.getState().setUiMode('discarding');
    expect(store.getState().game.uiMode).toBe('discarding');
  });
});

describe('applyServerMessage: game.error -> toast', () => {
  it('pushes an error toast carrying the code and message', () => {
    const store = createRootStore();
    store.getState().applyServerMessage(
      msg({ v: 1, type: 'game.error', payload: { code: 'NOT_YOUR_TURN', message: 'not your turn' } }),
    );

    const { toasts } = store.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]).toMatchObject({ kind: 'error', code: 'NOT_YOUR_TURN', message: 'not your turn' });
  });

  it('dismissToast removes exactly the dismissed toast', () => {
    const store = createRootStore();
    store.getState().applyServerMessage(
      msg({ v: 1, type: 'game.error', payload: { code: 'CANT_AFFORD', message: 'x' } }),
    );
    store.getState().applyServerMessage(
      msg({ v: 1, type: 'game.error', payload: { code: 'BAD_LOCATION', message: 'y' } }),
    );

    const [first] = store.getState().toasts;
    expect(first).toBeDefined();
    store.getState().dismissToast(first!.id);

    const { toasts } = store.getState();
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.code).toBe('BAD_LOCATION');
  });
});

describe('applyServerMessage: game.error routing (T-401 requirement 1)', () => {
  it('routes create/join-flow error codes to lobby.lastError, not a toast', () => {
    const store = createRootStore();
    store.getState().applyServerMessage(
      msg({ v: 1, type: 'game.error', payload: { code: 'PASSWORD_REQUIRED', message: 'need a password' } }),
    );

    expect(store.getState().toasts).toHaveLength(0);
    expect(store.getState().lobby.lastError).toEqual({
      code: 'PASSWORD_REQUIRED',
      message: 'need a password',
    });
  });

  it.each([
    'UNKNOWN_GAME',
    'LOBBY_FULL',
    'NICKNAME_TAKEN',
    'BAD_PASSWORD',
    'ALREADY_STARTED',
    'EXPANSION_NOT_AVAILABLE',
    'MODIFIER_INCOMPATIBLE',
  ])(
    '%s also routes to lobby.lastError',
    (code) => {
      const store = createRootStore();
      store.getState().applyServerMessage(msg({ v: 1, type: 'game.error', payload: { code, message: 'x' } }));
      expect(store.getState().lobby.lastError?.code).toBe(code);
      expect(store.getState().toasts).toHaveLength(0);
    },
  );

  it('a later successful lobby.state clears a pending lastError', () => {
    const store = createRootStore();
    store.getState().applyServerMessage(
      msg({ v: 1, type: 'game.error', payload: { code: 'BAD_PASSWORD', message: 'nope' } }),
    );
    expect(store.getState().lobby.lastError).not.toBeNull();

    store.getState().applyServerMessage(lobbyStateWithYou);
    expect(store.getState().lobby.lastError).toBeNull();
  });

  it('setLobbyError(null) clears it directly (UI edits a field after an error)', () => {
    const store = createRootStore();
    store.getState().setLobbyError({ code: 'BAD_PASSWORD', message: 'nope' });
    expect(store.getState().lobby.lastError).not.toBeNull();
    store.getState().setLobbyError(null);
    expect(store.getState().lobby.lastError).toBeNull();
  });
});

describe('applyServerMessage: chat.message and presence', () => {
  it('appends chat messages with stable incrementing ids', () => {
    const store = createRootStore();
    store.getState().applyServerMessage(
      msg({ v: 1, type: 'chat.message', payload: { seat: 0, nickname: 'Alice', text: 'hi' } }),
    );
    store.getState().applyServerMessage(
      msg({ v: 1, type: 'chat.message', payload: { seat: 1, nickname: 'Bob', text: 'yo' } }),
    );

    const { messages } = store.getState().chat;
    expect(messages.map((m) => m.text)).toEqual(['hi', 'yo']);
    expect(messages.map((m) => m.id)).toEqual([1, 2]);
  });

  it('tracks per-seat presence', () => {
    const store = createRootStore();
    store.getState().applyServerMessage(
      msg({ v: 1, type: 'presence', payload: { seat: 2, connected: false } }),
    );
    store.getState().applyServerMessage(
      msg({ v: 1, type: 'presence', payload: { seat: 2, connected: true } }),
    );
    store.getState().applyServerMessage(
      msg({ v: 1, type: 'presence', payload: { seat: 0, connected: false } }),
    );

    expect(store.getState().lobby.presence).toEqual({ 0: false, 2: true });
  });
});

describe('Home create flow, end to end through the store (T-401 requirement 5)', () => {
  it('sends the configured options and, once the server replies, seats us at 0 as host', () => {
    const sentLobby: LobbyOutboundMessage[] = [];
    setTransport({
      send: () => {},
      sendLobby: (m) => void sentLobby.push(m),
      sendChat: () => {},
      onUpdate: () => () => {},
    });
    const store = createRootStore();

    const config = { ...DEFAULT_ROOM_CONFIG, playerCount: 4 as const };
    store.getState().sendLobbyMessage(buildCreatePayload('Alice', config, ''));

    // What the wire actually saw: the exact options the create card had configured.
    expect(sentLobby).toEqual([
      { type: 'lobby.create', payload: { nickname: 'Alice', config } },
    ]);

    // The server's reply (T-203 §4: the creator always claims seat 0 as host).
    store.getState().applyServerMessage(
      msg({
        v: 1,
        type: 'lobby.state',
        payload: {
          gameId: 'g1',
          code: 'AB3D9',
          hostSeat: 0,
          seats: [{ occupant: 'human', nickname: 'Alice', ready: false }, null, null, null],
          you: { seat: 0, playerToken: 'tok-alice' },
        },
      }),
    );

    const { lobby } = store.getState();
    expect(lobby.gameId).toBe('g1');
    expect(lobby.mySeat).toBe(0);
    expect(lobby.hostSeat).toBe(0);
    expect(lobby.mySeat).toBe(lobby.hostSeat); // seat 0 host, per requirement 5
  });
});

describe('Home password retry flow (T-401 requirement 1 / D-031)', () => {
  it('PASSWORD_REQUIRED surfaces on lobby.lastError, then a password retry succeeds and clears it', () => {
    const sentLobby: LobbyOutboundMessage[] = [];
    setTransport({
      send: () => {},
      sendLobby: (m) => void sentLobby.push(m),
      sendChat: () => {},
      onUpdate: () => () => {},
    });
    const store = createRootStore();

    // First attempt: no password, the server-gated (D-031) room rejects it.
    store.getState().sendLobbyMessage(buildCreatePayload('Alice', DEFAULT_ROOM_CONFIG, ''));
    store.getState().applyServerMessage(
      msg({ v: 1, type: 'game.error', payload: { code: 'PASSWORD_REQUIRED', message: 'need a password' } }),
    );
    expect(store.getState().lobby.lastError?.code).toBe('PASSWORD_REQUIRED');
    expect(store.getState().toasts).toHaveLength(0); // inline, never a toast

    // Retry with the password the (simulated) user was prompted for.
    store.getState().setLobbyError(null);
    store.getState().sendLobbyMessage(buildCreatePayload('Alice', DEFAULT_ROOM_CONFIG, 'letmein'));
    store.getState().applyServerMessage(
      msg({
        v: 1,
        type: 'lobby.state',
        payload: {
          gameId: 'g2',
          code: 'ZZ2Z2',
          hostSeat: 0,
          seats: [{ occupant: 'human', nickname: 'Alice', ready: false }, null, null, null],
          you: { seat: 0, playerToken: 'tok-alice' },
        },
      }),
    );

    expect(sentLobby[1]).toEqual({
      type: 'lobby.create',
      payload: { nickname: 'Alice', config: DEFAULT_ROOM_CONFIG, password: 'letmein' },
    });
    expect(store.getState().lobby.lastError).toBeNull();
    expect(store.getState().lobby.gameId).toBe('g2');
  });
});

describe('outbound intents forward to the active GameTransport', () => {
  function mockTransport() {
    const calls: { actions: Action[]; lobby: LobbyOutboundMessage[]; chat: string[] } = {
      actions: [],
      lobby: [],
      chat: [],
    };
    const transport: GameTransport = {
      send: (action) => void calls.actions.push(action),
      sendLobby: (m) => void calls.lobby.push(m),
      sendChat: (text) => void calls.chat.push(text),
      onUpdate: () => () => {},
    };
    return { transport, calls };
  }

  it('sendAction / sendLobbyMessage / sendChatMessage call the transport, not a socket', () => {
    const { transport, calls } = mockTransport();
    setTransport(transport);
    const store = createRootStore();

    store.getState().sendAction({ type: 'endTurn' });
    store.getState().sendLobbyMessage({ type: 'lobby.ready', payload: { ready: true } });
    store.getState().sendChatMessage('hello');

    expect(calls.actions).toEqual([{ type: 'endTurn' }]);
    expect(calls.lobby).toEqual([{ type: 'lobby.ready', payload: { ready: true } }]);
    expect(calls.chat).toEqual(['hello']);
  });

  it('is a safe no-op when no transport is registered', () => {
    setTransport(null);
    const store = createRootStore();
    expect(() => store.getState().sendAction({ type: 'endTurn' })).not.toThrow();
    expect(() => store.getState().sendChatMessage('x')).not.toThrow();
  });
});
