import { describe, it, expect } from 'vitest';
import {
  ClientMessageSchema,
  ServerMessageSchema,
  LobbyCreateMessageSchema,
  LobbyJoinMessageSchema,
  LobbyReadyMessageSchema,
  LobbyStartMessageSchema,
  LobbyAddBotMessageSchema,
  LobbyRemoveBotMessageSchema,
  GameActionMessageSchema,
  GameRejoinMessageSchema,
  ChatSendMessageSchema,
  LobbyStateMessageSchema,
  GameStartedMessageSchema,
  GameEventsMessageSchema,
  GameSyncMessageSchema,
  GameErrorMessageSchema,
  ChatRelayMessageSchema,
  PresenceMessageSchema,
  TimerMessageSchema,
  parseClientMessage,
} from './messages.js';

const validRoomConfig = {
  playerCount: 4,
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
  timers: { timers: false, turnSeconds: 120, decisionSeconds: 45 },
};

describe('client -> server messages round-trip', () => {
  const samples: Array<[string, unknown]> = [
    [
      'lobby.create',
      { v: 1, type: 'lobby.create', payload: { nickname: 'Alice', config: validRoomConfig } },
    ],
    [
      'lobby.create (with password)',
      {
        v: 1,
        type: 'lobby.create',
        payload: { nickname: 'Alice', config: validRoomConfig, password: 'secret' },
      },
    ],
    ['lobby.join', { v: 1, type: 'lobby.join', payload: { code: 'A2B3C', nickname: 'Bob' } }],
    ['lobby.ready', { v: 1, type: 'lobby.ready', payload: { ready: true } }],
    ['lobby.start', { v: 1, type: 'lobby.start', payload: {} }],
    ['lobby.addBot', { v: 1, type: 'lobby.addBot', payload: { seat: 1 } }],
    ['lobby.removeBot', { v: 1, type: 'lobby.removeBot', payload: { seat: 1 } }],
    ['game.action', { v: 1, type: 'game.action', payload: { action: { type: 'endTurn' } } }],
    [
      'game.rejoin',
      { v: 1, type: 'game.rejoin', payload: { gameId: 'g1', playerToken: 'tok-123' } },
    ],
    ['chat.send', { v: 1, type: 'chat.send', payload: { text: 'hello table' } }],
  ];

  it.each(samples)('%s parses via ClientMessageSchema', (_label, msg) => {
    const result = ClientMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(msg);
    }
  });

  it.each(samples)('%s rejects wrong v', (_label, msg) => {
    const bad = { ...(msg as Record<string, unknown>), v: 2 };
    expect(ClientMessageSchema.safeParse(bad).success).toBe(false);
  });

  it('game.action round-trips a nested action with a branded id field', () => {
    const msg = { v: 1, type: 'game.action', payload: { action: { type: 'buildRoad', edge: 5 } } };
    const result = GameActionMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.action).toEqual({ type: 'buildRoad', edge: 5 });
    }
  });
});

describe('server -> client messages round-trip', () => {
  const samples: Array<[string, unknown]> = [
    [
      'lobby.state',
      {
        v: 1,
        type: 'lobby.state',
        payload: {
          gameId: 'g1',
          code: 'A2B3C',
          hostSeat: 0,
          seats: [{ occupant: 'human', nickname: 'Alice', ready: true }, null, null, null],
          you: { seat: 0, playerToken: 'tok-123' },
        },
      },
    ],
    [
      'lobby.state (no you, third-party view)',
      {
        v: 1,
        type: 'lobby.state',
        payload: {
          gameId: 'g1',
          code: 'A2B3C',
          hostSeat: 0,
          seats: [
            { occupant: 'human', nickname: 'Alice', ready: true },
            { occupant: 'human', nickname: 'Bob', ready: false },
          ],
        },
      },
    ],
    [
      'lobby.state (with a bot seat: nickname is null, per the i18n cross-cutting rule)',
      {
        v: 1,
        type: 'lobby.state',
        payload: {
          gameId: 'g1',
          code: 'A2B3C',
          hostSeat: 0,
          seats: [
            { occupant: 'human', nickname: 'Alice', ready: true },
            { occupant: 'bot', nickname: null, ready: true },
          ],
        },
      },
    ],
    ['game.started', { v: 1, type: 'game.started', payload: { me: 0, fake: 'player-view' } }],
    [
      'game.events',
      {
        v: 1,
        type: 'game.events',
        payload: { events: [{ type: 'turnEnded', seat: 0, next: 1 }], stateVersion: 3 },
      },
    ],
    ['game.sync', { v: 1, type: 'game.sync', payload: { me: 0, fake: 'player-view' } }],
    [
      'game.error (engine code)',
      { v: 1, type: 'game.error', payload: { code: 'NOT_YOUR_TURN', message: 'not your turn' } },
    ],
    [
      'game.error (protocol code)',
      { v: 1, type: 'game.error', payload: { code: 'LOBBY_FULL', message: 'lobby is full' } },
    ],
    [
      'chat.message',
      { v: 1, type: 'chat.message', payload: { seat: 1, nickname: 'Bob', text: 'hi' } },
    ],
    ['presence', { v: 1, type: 'presence', payload: { seat: 2, connected: false } }],
    [
      'timer',
      {
        v: 1,
        type: 'timer',
        payload: { deadlines: [{ seat: 0, deadline: 1_700_000_000_000 }, { seat: 2, deadline: 1_700_000_045_000 }] },
      },
    ],
  ];

  it.each(samples)('%s parses via ServerMessageSchema', (_label, msg) => {
    const result = ServerMessageSchema.safeParse(msg);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(msg);
    }
  });

  it.each(samples)('%s rejects wrong v', (_label, msg) => {
    const bad = { ...(msg as Record<string, unknown>), v: 2 };
    expect(ServerMessageSchema.safeParse(bad).success).toBe(false);
  });
});

describe('envelope rejects wrong v', () => {
  it('rejects v: 2 on a client message', () => {
    const result = LobbyReadyMessageSchema.safeParse({ v: 2, type: 'lobby.ready', payload: { ready: true } });
    expect(result.success).toBe(false);
  });

  it('rejects v: 2 on a server message', () => {
    const result = PresenceMessageSchema.safeParse({ v: 2, type: 'presence', payload: { seat: 0, connected: true } });
    expect(result.success).toBe(false);
  });

  it('rejects a missing v', () => {
    const result = LobbyStartMessageSchema.safeParse({ type: 'lobby.start', payload: {} });
    expect(result.success).toBe(false);
  });

  it('ClientMessageSchema rejects wrong v regardless of type', () => {
    const result = ClientMessageSchema.safeParse({ v: 1.5, type: 'lobby.ready', payload: { ready: true } });
    expect(result.success).toBe(false);
  });
});

describe('envelope rejects unknown type', () => {
  it('ClientMessageSchema rejects an unrecognized type', () => {
    const result = ClientMessageSchema.safeParse({ v: 1, type: 'lobby.explode', payload: {} });
    expect(result.success).toBe(false);
  });

  it('ServerMessageSchema rejects an unrecognized type', () => {
    const result = ServerMessageSchema.safeParse({ v: 1, type: 'server.explode', payload: {} });
    expect(result.success).toBe(false);
  });

  it('a client-only type is not a valid server message and vice versa', () => {
    expect(
      ServerMessageSchema.safeParse({ v: 1, type: 'lobby.create', payload: { nickname: 'x', config: validRoomConfig } })
        .success,
    ).toBe(false);
    expect(ClientMessageSchema.safeParse({ v: 1, type: 'lobby.state', payload: {} }).success).toBe(false);
  });
});

describe('lobby.create / lobby.join nickname validation', () => {
  it('accepts a 1-char and a 20-char nickname', () => {
    expect(
      LobbyCreateMessageSchema.safeParse({
        v: 1,
        type: 'lobby.create',
        payload: { nickname: 'A', config: validRoomConfig },
      }).success,
    ).toBe(true);
    expect(
      LobbyCreateMessageSchema.safeParse({
        v: 1,
        type: 'lobby.create',
        payload: { nickname: 'A'.repeat(20), config: validRoomConfig },
      }).success,
    ).toBe(true);
  });

  it('rejects a 21-char nickname on lobby.create', () => {
    const result = LobbyCreateMessageSchema.safeParse({
      v: 1,
      type: 'lobby.create',
      payload: { nickname: 'A'.repeat(21), config: validRoomConfig },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a 21-char nickname on lobby.join', () => {
    const result = LobbyJoinMessageSchema.safeParse({
      v: 1,
      type: 'lobby.join',
      payload: { code: 'A2B3C', nickname: 'A'.repeat(21) },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty (or whitespace-only) nickname', () => {
    expect(
      LobbyJoinMessageSchema.safeParse({ v: 1, type: 'lobby.join', payload: { code: 'A2B3C', nickname: '' } })
        .success,
    ).toBe(false);
    expect(
      LobbyJoinMessageSchema.safeParse({ v: 1, type: 'lobby.join', payload: { code: 'A2B3C', nickname: '   ' } })
        .success,
    ).toBe(false);
  });

  it('trims surrounding whitespace', () => {
    const result = LobbyJoinMessageSchema.safeParse({
      v: 1,
      type: 'lobby.join',
      payload: { code: 'A2B3C', nickname: '  Alice  ' },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.payload.nickname).toBe('Alice');
    }
  });
});

describe('lobby code regex ^[A-HJ-NP-Z2-9]{5}$', () => {
  const validCodes = ['A2B3C', 'ABCDE', 'HJKLM', 'XYZ23', '99999', '22222'];
  const invalidCodes = [
    'a2b3c', // lowercase
    'A2O3C', // ambiguous O
    'A203C', // ambiguous 0
    'A213C', // ambiguous 1
    'A2I3C', // ambiguous I
    'AB', // too short
    'ABCDEF', // too long
    'AB-DE', // invalid char
  ];

  it.each(validCodes.map((c) => [c] as const))('accepts %s', (code) => {
    const result = LobbyJoinMessageSchema.safeParse({
      v: 1,
      type: 'lobby.join',
      payload: { code, nickname: 'Bob' },
    });
    expect(result.success).toBe(true);
  });

  it.each(invalidCodes.map((c) => [c] as const))('rejects %s', (code) => {
    const result = LobbyJoinMessageSchema.safeParse({
      v: 1,
      type: 'lobby.join',
      payload: { code, nickname: 'Bob' },
    });
    expect(result.success).toBe(false);
  });
});

describe('chat.send length validation', () => {
  it('accepts a 1-char and a 300-char message', () => {
    expect(
      ChatSendMessageSchema.safeParse({ v: 1, type: 'chat.send', payload: { text: 'a' } }).success,
    ).toBe(true);
    expect(
      ChatSendMessageSchema.safeParse({ v: 1, type: 'chat.send', payload: { text: 'a'.repeat(300) } })
        .success,
    ).toBe(true);
  });

  it('rejects a 301-char message', () => {
    const result = ChatSendMessageSchema.safeParse({
      v: 1,
      type: 'chat.send',
      payload: { text: 'a'.repeat(301) },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty message', () => {
    expect(
      ChatSendMessageSchema.safeParse({ v: 1, type: 'chat.send', payload: { text: '' } }).success,
    ).toBe(false);
  });
});

describe('lobby.create config validation', () => {
  it('rejects an out-of-range playerCount', () => {
    const result = LobbyCreateMessageSchema.safeParse({
      v: 1,
      type: 'lobby.create',
      payload: { nickname: 'Alice', config: { ...validRoomConfig, playerCount: 7 } },
    });
    expect(result.success).toBe(false);
  });

  it('is schema-valid for an unshipped expansion (server/engine gates availability, not the schema)', () => {
    const result = LobbyCreateMessageSchema.safeParse({
      v: 1,
      type: 'lobby.create',
      payload: {
        nickname: 'Alice',
        config: {
          playerCount: 6,
          expansions: { fiveSix: true, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: true },
          timers: { timers: true, turnSeconds: 120, decisionSeconds: 45 },
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a malformed expansions shape', () => {
    const result = LobbyCreateMessageSchema.safeParse({
      v: 1,
      type: 'lobby.create',
      payload: {
        nickname: 'Alice',
        config: { ...validRoomConfig, expansions: { fiveSix: 'yes' } },
      },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a missing timers config', () => {
    const configWithoutTimers = {
      playerCount: validRoomConfig.playerCount,
      expansions: validRoomConfig.expansions,
    };
    const result = LobbyCreateMessageSchema.safeParse({
      v: 1,
      type: 'lobby.create',
      payload: { nickname: 'Alice', config: configWithoutTimers },
    });
    expect(result.success).toBe(false);
  });
});

describe('lobby.start / lobby.ready payload shape', () => {
  it('lobby.start rejects a non-empty payload', () => {
    const result = LobbyStartMessageSchema.safeParse({ v: 1, type: 'lobby.start', payload: { extra: true } });
    expect(result.success).toBe(false);
  });

  it('lobby.ready requires the ready boolean', () => {
    expect(LobbyReadyMessageSchema.safeParse({ v: 1, type: 'lobby.ready', payload: {} }).success).toBe(
      false,
    );
  });
});

describe('lobby.addBot / lobby.removeBot payload shape (T-411 §1)', () => {
  it('accepts every valid seat value 0-5', () => {
    for (const seat of [0, 1, 2, 3, 4, 5]) {
      expect(LobbyAddBotMessageSchema.safeParse({ v: 1, type: 'lobby.addBot', payload: { seat } }).success).toBe(
        true,
      );
      expect(
        LobbyRemoveBotMessageSchema.safeParse({ v: 1, type: 'lobby.removeBot', payload: { seat } }).success,
      ).toBe(true);
    }
  });

  it('rejects a seat outside 0-5', () => {
    expect(LobbyAddBotMessageSchema.safeParse({ v: 1, type: 'lobby.addBot', payload: { seat: 6 } }).success).toBe(
      false,
    );
    expect(
      LobbyRemoveBotMessageSchema.safeParse({ v: 1, type: 'lobby.removeBot', payload: { seat: -1 } }).success,
    ).toBe(false);
  });

  it('rejects a missing seat', () => {
    expect(LobbyAddBotMessageSchema.safeParse({ v: 1, type: 'lobby.addBot', payload: {} }).success).toBe(false);
  });

  it('rejects an unknown extra field (strict payload, no difficulty/tier field allowed)', () => {
    expect(
      LobbyAddBotMessageSchema.safeParse({
        v: 1,
        type: 'lobby.addBot',
        payload: { seat: 1, difficulty: 'hard' },
      }).success,
    ).toBe(false);
  });
});

describe('game.rejoin payload shape', () => {
  it('rejects a missing playerToken', () => {
    const result = GameRejoinMessageSchema.safeParse({
      v: 1,
      type: 'game.rejoin',
      payload: { gameId: 'g1' },
    });
    expect(result.success).toBe(false);
  });
});

describe('parseClientMessage', () => {
  it('returns ok:true with the parsed message for a valid frame', () => {
    const raw = { v: 1, type: 'lobby.ready', payload: { ready: true } };
    const result = parseClientMessage(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.msg).toEqual(raw);
    }
  });

  it('returns BAD_MESSAGE for a wrong v', () => {
    const result = parseClientMessage({ v: 2, type: 'lobby.ready', payload: { ready: true } });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('BAD_MESSAGE');
      expect(result.detail.length).toBeGreaterThan(0);
    }
  });

  it('returns BAD_MESSAGE for an unknown type', () => {
    const result = parseClientMessage({ v: 1, type: 'not.a.real.type', payload: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('BAD_MESSAGE');
    }
  });

  it('returns BAD_MESSAGE for a non-object frame', () => {
    expect(parseClientMessage(null).ok).toBe(false);
    expect(parseClientMessage('just a string').ok).toBe(false);
    expect(parseClientMessage(42).ok).toBe(false);
    const result = parseClientMessage(null);
    if (!result.ok) {
      expect(result.code).toBe('BAD_MESSAGE');
    }
  });

  it('returns BAD_ACTION for a malformed embedded action (out-of-range id)', () => {
    const result = parseClientMessage({
      v: 1,
      type: 'game.action',
      payload: { action: { type: 'buildSettlement', vertex: 999 } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('BAD_ACTION');
    }
  });

  it('returns BAD_ACTION for an unrecognized embedded action type', () => {
    const result = parseClientMessage({
      v: 1,
      type: 'game.action',
      payload: { action: { type: 'teleport' } },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('BAD_ACTION');
    }
  });

  it('returns BAD_ACTION when the action field is missing entirely', () => {
    const result = parseClientMessage({ v: 1, type: 'game.action', payload: {} });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('BAD_ACTION');
    }
  });

  it('accepts a valid game.action frame', () => {
    const result = parseClientMessage({
      v: 1,
      type: 'game.action',
      payload: { action: { type: 'rollDice' } },
    });
    expect(result.ok).toBe(true);
  });
});

describe('per-message schema exports', () => {
  // lobby.state/game.started/game.events/game.sync/game.error/chat.message are only exercised
  // above via the aggregate ServerMessageSchema table; this proves each individual named export
  // (what a consumer would actually import to validate one specific message type) also resolves
  // and parses on its own.
  it('every individual message schema is exported and callable', () => {
    for (const schema of [
      LobbyCreateMessageSchema,
      LobbyJoinMessageSchema,
      LobbyReadyMessageSchema,
      LobbyStartMessageSchema,
      LobbyAddBotMessageSchema,
      LobbyRemoveBotMessageSchema,
      GameActionMessageSchema,
      GameRejoinMessageSchema,
      ChatSendMessageSchema,
      LobbyStateMessageSchema,
      GameStartedMessageSchema,
      GameEventsMessageSchema,
      GameSyncMessageSchema,
      GameErrorMessageSchema,
      ChatRelayMessageSchema,
      PresenceMessageSchema,
      TimerMessageSchema,
    ]) {
      expect(typeof schema.safeParse).toBe('function');
    }
  });
});
