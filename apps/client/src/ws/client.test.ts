// ws client tests against a real local `ws` mock server (T-301 §7): connect + outbound envelope
// shapes, malformed-frame tolerance, session capture, reconnect + auto-rejoin, protocol-level
// heartbeat pong, and stateVersion-gap -> game.syncRequest.
//
// Node >= 22 ships a WHATWG `WebSocket` global (undici), so `createWsTransport` runs unmodified
// here — same code path a browser takes, including the RFC 6455 auto-pong the heartbeat test
// observes from the server side.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { once } from 'node:events';
import type { ServerMessage } from '@hexhaven/shared';
import { createWsTransport, resolveWsUrl, type WsTransport } from './client';
import type { StorageLike, StoredSession } from './session';
import { startMockServer, waitFor, type MockServer } from './testServer';

function fakeStorage(session?: StoredSession): StorageLike {
  const data = new Map<string, string>();
  if (session) data.set('hexhaven.session', JSON.stringify(session));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const SESSION: StoredSession = { gameId: 'g1', playerToken: 'tok-1', nickname: 'Alice' };

// Fast backoff so reconnect tests complete quickly: 10 -> 20 -> 40 (cap).
const FAST = { baseDelayMs: 10, maxDelayMs: 40 };

let server: MockServer;
let transport: WsTransport | null = null;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(async () => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  server = await startMockServer();
});

afterEach(async () => {
  transport?.disconnect();
  transport = null;
  await server.close();
  warnSpy.mockRestore();
});

function connect(opts: { storage?: StorageLike | null; onStatusChange?: (s: string) => void } = {}) {
  transport = createWsTransport({
    url: server.url,
    storage: opts.storage ?? null,
    onStatusChange: opts.onStatusChange,
    ...FAST,
  });
  return transport;
}

describe('resolveWsUrl', () => {
  it('appends /ws and passes ws:// urls through', () => {
    expect(resolveWsUrl('ws://example.test:8080')).toBe('ws://example.test:8080/ws');
  });

  it('translates http(s) bases to ws(s)', () => {
    expect(resolveWsUrl('http://example.test:8080')).toBe('ws://example.test:8080/ws');
    expect(resolveWsUrl('https://example.test')).toBe('wss://example.test/ws');
  });

  it('strips trailing slashes before appending /ws', () => {
    expect(resolveWsUrl('ws://example.test/')).toBe('ws://example.test/ws');
  });
});

describe('connect & outbound envelopes', () => {
  it('reaches open status and wraps send/sendLobby/sendChat in v1 envelopes', async () => {
    const statuses: string[] = [];
    const t = connect({ onStatusChange: (s) => statuses.push(s) });
    await waitFor(() => statuses.includes('open'), 4000, 'socket open');

    t.send({ type: 'endTurn' });
    t.sendLobby({ type: 'lobby.ready', payload: { ready: true } });
    t.sendChat('hello');
    await waitFor(() => server.received.length >= 3, 4000, '3 frames received');

    expect(server.received).toEqual([
      { v: 1, type: 'game.action', payload: { action: { type: 'endTurn' } } },
      { v: 1, type: 'lobby.ready', payload: { ready: true } },
      { v: 1, type: 'chat.send', payload: { text: 'hello' } },
    ]);
    expect(statuses[0]).toBe('connecting');
  });

  it('does not send game.rejoin when no session is stored', async () => {
    const statuses: string[] = [];
    connect({ onStatusChange: (s) => statuses.push(s) });
    await waitFor(() => statuses.includes('open'), 4000, 'socket open');
    // Give any (wrong) rejoin a moment to arrive before asserting silence.
    await new Promise((r) => setTimeout(r, 50));
    expect(server.received).toEqual([]);
  });
});

describe('inbound parsing (zod via @hexhaven/shared)', () => {
  it('delivers valid server messages to onUpdate subscribers', async () => {
    const t = connect();
    const inbound: ServerMessage[] = [];
    t.onUpdate((msg) => inbound.push(msg));
    await server.nextConnection();

    server.send({ v: 1, type: 'chat.message', payload: { seat: 0, nickname: 'Alice', text: 'hi' } });
    await waitFor(() => inbound.length === 1, 4000, 'chat delivered');
    expect(inbound[0]).toMatchObject({ type: 'chat.message' });
  });

  it('warns and ignores malformed frames, then keeps working', async () => {
    const t = connect();
    const inbound: ServerMessage[] = [];
    t.onUpdate((msg) => inbound.push(msg));
    await server.nextConnection();

    server.send('this is not json');
    server.send({ v: 1, type: 'no.such.type', payload: {} });
    server.send({ v: 2, type: 'presence', payload: { seat: 0, connected: true } });
    server.send({ v: 1, type: 'presence', payload: { seat: 0, connected: true } });

    await waitFor(() => inbound.length === 1, 4000, 'only the valid frame delivered');
    expect(inbound[0]).toMatchObject({ type: 'presence' });
    expect(warnSpy).toHaveBeenCalledTimes(3);
  });
});

describe('session capture from lobby.state', () => {
  it('persists {gameId, playerToken, nickname} under hexhaven.session when `you` is present', async () => {
    const storage = fakeStorage();
    connect({ storage });
    await server.nextConnection();

    server.send({
      v: 1,
      type: 'lobby.state',
      payload: {
        gameId: 'g9',
        code: 'A2B3C',
        hostSeat: 0,
        seats: [{ occupant: 'human', nickname: 'Zoe', ready: false }, null, null, null],
        you: { seat: 0, playerToken: 'tok-9' },
      },
    });

    await waitFor(() => storage.getItem('hexhaven.session') !== null, 4000, 'session stored');
    expect(JSON.parse(storage.getItem('hexhaven.session')!)).toEqual({
      gameId: 'g9',
      playerToken: 'tok-9',
      nickname: 'Zoe',
    });
  });
});

describe('reconnect + rejoin', () => {
  it('rejoins with the stored token on first connect and again after a reconnect', async () => {
    const statuses: string[] = [];
    connect({ storage: fakeStorage(SESSION), onStatusChange: (s) => statuses.push(s) });

    await waitFor(() => server.received.length >= 1, 4000, 'initial rejoin');
    expect(server.received[0]).toEqual({
      v: 1,
      type: 'game.rejoin',
      payload: { gameId: 'g1', playerToken: 'tok-1' },
    });

    // Simulate a server crash, then bring it back on the same port.
    const port = server.port;
    await server.close();
    await waitFor(() => statuses.includes('reconnecting'), 4000, 'enters reconnecting');
    server = await startMockServer(port);

    await waitFor(() => server.received.length >= 1, 8000, 'rejoin after reconnect');
    expect(server.received[0]).toEqual({
      v: 1,
      type: 'game.rejoin',
      payload: { gameId: 'g1', playerToken: 'tok-1' },
    });
    expect(statuses[statuses.length - 1]).toBe('open');
  }, 15000);

  it('disconnect() stops the reconnect loop and reports closed', async () => {
    const statuses: string[] = [];
    const t = connect({ onStatusChange: (s) => statuses.push(s) });
    await waitFor(() => statuses.includes('open'), 4000, 'socket open');

    t.disconnect();
    await waitFor(() => statuses.includes('closed'), 4000, 'reports closed');
    // No reconnection attempts follow an intentional close.
    await new Promise((r) => setTimeout(r, 100));
    expect(statuses.filter((s) => s === 'reconnecting')).toEqual([]);
    expect(server.sockets).toHaveLength(0);
  });
});

describe('heartbeat', () => {
  it('answers a server ws ping with a pong (protocol-level, observed server-side)', async () => {
    connect();
    const socket = await server.nextConnection();

    const pongReceived = once(socket, 'pong');
    socket.ping();
    await expect(Promise.race([
      pongReceived,
      new Promise((_, reject) => setTimeout(() => reject(new Error('no pong within 4s')), 4000)),
    ])).resolves.toBeDefined();
  });
});

describe('stateVersion gap -> game.syncRequest', () => {
  function view(stateVersion: number) {
    return { me: 0, stateVersion };
  }

  it('requests a sync when game.events skips ahead of the last seen version', async () => {
    connect({ storage: fakeStorage(SESSION) });
    await server.nextConnection();
    await waitFor(() => server.received.length >= 1, 4000, 'rejoin sent'); // baseline: rejoin frame

    server.send({ v: 1, type: 'game.started', payload: view(0) });
    server.send({ v: 1, type: 'game.events', payload: { events: [], stateVersion: 1, view: view(1) } });
    server.send({ v: 1, type: 'game.events', payload: { events: [], stateVersion: 4, view: view(4) } });

    await waitFor(
      () => server.received.some((f) => f.type === 'game.syncRequest'),
      4000,
      'syncRequest sent',
    );
    const syncRequests = server.received.filter((f) => f.type === 'game.syncRequest');
    expect(syncRequests).toEqual([{ v: 1, type: 'game.syncRequest', payload: { gameId: 'g1' } }]);
  });

  it('does not request a sync for contiguous versions or after a re-baselining game.sync', async () => {
    const t = connect({ storage: fakeStorage(SESSION) });
    const inbound: ServerMessage[] = [];
    t.onUpdate((m) => inbound.push(m));
    await server.nextConnection();

    server.send({ v: 1, type: 'game.started', payload: view(0) });
    server.send({ v: 1, type: 'game.events', payload: { events: [], stateVersion: 1, view: view(1) } });
    server.send({ v: 1, type: 'game.events', payload: { events: [], stateVersion: 2, view: view(2) } });
    // A full sync far ahead re-baselines rather than reading as a gap...
    server.send({ v: 1, type: 'game.sync', payload: view(7) });
    // ...so the next contiguous events frame is quiet too.
    server.send({ v: 1, type: 'game.events', payload: { events: [], stateVersion: 8, view: view(8) } });

    await waitFor(() => inbound.length === 5, 4000, 'all five messages delivered');
    expect(server.received.filter((f) => f.type === 'game.syncRequest')).toEqual([]);
  });
});
