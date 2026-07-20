// The real (networked) `GameTransport` implementation (T-301 §4, docs/02 §5, D-013).
//
// - Connects to `VITE_SERVER_URL + /ws` (default: same origin, `wss://` when the page is `https:`).
// - zod-validates every inbound frame against `@hexhaven/shared`'s `ServerMessageSchema`; a malformed
//   frame is `console.warn`'d and dropped, never thrown.
// - Reconnects with exponential backoff, 0.5s -> 8s cap.
// - Heartbeat: the server pings over the raw ws connection every 15s (apps/server/src/wsHub.ts);
//   responding with a pong is automatic at the WebSocket protocol layer (RFC 6455) for both
//   browsers and Node's built-in `WebSocket` — there is no application-level pong to hand-write.
//   What *is* this module's job is the other half: react to `close`/`error` (a connection the
//   server gave up pinging gets terminated, which fires `close`) by reconnecting.
// - After every successful open — a fresh page load *or* a reconnect, same code path — sends
//   `game.rejoin` if a session is stored, and re-baselines `stateVersion` from whatever full
//   `PlayerView` comes back so a later `game.events` gap triggers exactly one `game.syncRequest`.
import { ServerMessageSchema, type Action, type ServerMessage } from '@hexhaven/shared';
import type { GameTransport, LobbyOutboundMessage } from '../store/transport';
import type { ConnectionStatus } from '../store/types';
import { defaultStorage, readSession, saveSession, type StorageLike } from './session';

export interface WsClientOptions {
  /** Overrides the resolved connect URL entirely. Mainly for tests. */
  url?: string;
  onStatusChange?: (status: ConnectionStatus) => void;
  /** Defaults to `window.localStorage` (or a no-op outside a browser). Injectable for tests. */
  storage?: StorageLike | null;
  /** Base reconnect delay in ms (docs/02 §5, T-301 §4: 0.5s -> 8s). Defaults to 500. */
  baseDelayMs?: number;
  /** Reconnect delay cap in ms. Defaults to 8000. */
  maxDelayMs?: number;
}

export interface WsTransport extends GameTransport {
  /** Closes the socket and stops reconnecting. For app teardown and test cleanup. */
  disconnect(): void;
}

const DEFAULT_BASE_DELAY_MS = 500;
const DEFAULT_MAX_DELAY_MS = 8000;

/** `override ?? VITE_SERVER_URL ?? same-origin` + `/ws`, translating an `http(s)` base to `ws(s)`
 * if whoever set it forgot to (a common footgun `VITE_SERVER_URL=http://host:port` mistake). */
export function resolveWsUrl(override?: string): string {
  const envUrl = import.meta.env.VITE_SERVER_URL || undefined;
  const base = override ?? envUrl ?? sameOriginWsBase();
  return `${toWsBase(base).replace(/\/+$/, '')}/ws`;
}

function sameOriginWsBase(): string {
  if (typeof window === 'undefined') {
    throw new Error('resolveWsUrl: no window to derive a same-origin URL from; pass options.url');
  }
  const isHttps = window.location.protocol === 'https:';
  return `${isHttps ? 'wss' : 'ws'}://${window.location.host}`;
}

function toWsBase(base: string): string {
  if (base.startsWith('https://')) return `wss://${base.slice('https://'.length)}`;
  if (base.startsWith('http://')) return `ws://${base.slice('http://'.length)}`;
  return base;
}

function extractStateVersion(playerView: unknown): number | null {
  if (typeof playerView !== 'object' || playerView === null) return null;
  const v = (playerView as Record<string, unknown>).stateVersion;
  return typeof v === 'number' ? v : null;
}

export function createWsTransport(options: WsClientOptions = {}): WsTransport {
  const baseDelayMs = options.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;
  const storage = options.storage !== undefined ? options.storage : defaultStorage();
  const url = resolveWsUrl(options.url);

  const subscribers = new Set<(msg: ServerMessage) => void>();
  let socket: WebSocket | null = null;
  let attempt = 0;
  let backoffTimer: ReturnType<typeof setTimeout> | null = null;
  let intentionallyClosed = false;
  let lastStateVersion: number | null = null;

  function setStatus(status: ConnectionStatus): void {
    options.onStatusChange?.(status);
  }

  function computeDelay(n: number): number {
    return Math.min(maxDelayMs, baseDelayMs * 2 ** n);
  }

  function sendEnvelope(msg: { type: string; payload: unknown }): void {
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      console.warn(`[ws] dropped outbound "${msg.type}": socket not open`);
      return;
    }
    socket.send(JSON.stringify({ v: 1, ...msg }));
  }

  function maybeRejoin(): void {
    const session = readSession(storage);
    if (!session) return;
    sendEnvelope({
      type: 'game.rejoin',
      payload: { gameId: session.gameId, playerToken: session.playerToken },
    });
  }

  function requestSync(): void {
    const session = readSession(storage);
    if (!session) return; // can't identify the game to resync without a stored session
    sendEnvelope({ type: 'game.syncRequest', payload: { gameId: session.gameId } });
  }

  function handleParsedMessage(msg: ServerMessage): void {
    if (msg.type === 'lobby.state' && msg.payload.you) {
      // The seat/token assignment arrives inside lobby.state (T-203 §4). Persisting it here — in
      // the transport, not a store reduction — keeps reductions side-effect-free and means the
      // hot-seat transport (T-305) never writes network sessions.
      saveSession(
        {
          gameId: msg.payload.gameId,
          playerToken: msg.payload.you.playerToken,
          nickname: msg.payload.seats[msg.payload.you.seat]?.nickname ?? '',
        },
        storage,
      );
    } else if (msg.type === 'game.started' || msg.type === 'game.sync') {
      // Authoritative full-view messages always establish a fresh baseline — never treated as a
      // gap themselves, or a resync response could trigger an immediate second resync request.
      lastStateVersion = extractStateVersion(msg.payload);
    } else if (msg.type === 'game.events') {
      const { stateVersion } = msg.payload;
      if (lastStateVersion !== null && stateVersion !== lastStateVersion + 1) {
        requestSync();
      }
      lastStateVersion = stateVersion;
    }
    for (const cb of subscribers) cb(msg);
  }

  function handleRawData(data: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(data));
    } catch {
      console.warn('[ws] received non-JSON frame, ignoring');
      return;
    }
    const result = ServerMessageSchema.safeParse(parsed);
    if (!result.success) {
      console.warn('[ws] malformed server message, ignoring:', result.error.issues);
      return;
    }
    handleParsedMessage(result.data);
  }

  function scheduleReconnect(): void {
    setStatus('reconnecting');
    const delay = computeDelay(attempt);
    attempt += 1;
    backoffTimer = setTimeout(() => {
      backoffTimer = null;
      openSocket();
    }, delay);
  }

  function openSocket(): void {
    setStatus(attempt === 0 ? 'connecting' : 'reconnecting');
    const ws = new WebSocket(url);
    socket = ws;

    ws.addEventListener('open', () => {
      attempt = 0;
      setStatus('open');
      maybeRejoin();
    });

    ws.addEventListener('message', (ev) => handleRawData(ev.data));

    ws.addEventListener('close', () => {
      socket = null;
      if (intentionallyClosed) {
        setStatus('closed');
        return;
      }
      scheduleReconnect();
    });

    // 'close' always follows 'error' for connection failures (WHATWG WS spec) and owns reconnect
    // scheduling — this listener only exists so a failed connection doesn't surface as an
    // unhandled error event in the browser console / test runner.
    ws.addEventListener('error', () => {});
  }

  openSocket();

  return {
    send(action: Action) {
      sendEnvelope({ type: 'game.action', payload: { action } });
    },
    sendLobby(msg: LobbyOutboundMessage) {
      sendEnvelope(msg);
    },
    sendChat(text: string) {
      sendEnvelope({ type: 'chat.send', payload: { text } });
    },
    onUpdate(cb: (msg: ServerMessage) => void) {
      subscribers.add(cb);
      return () => subscribers.delete(cb);
    },
    disconnect() {
      intentionallyClosed = true;
      if (backoffTimer) {
        clearTimeout(backoffTimer);
        backoffTimer = null;
      }
      socket?.close(1000, 'client disconnect');
      socket = null;
      setStatus('closed');
    },
  };
}
