// Mock ws server used by client.test.ts (T-301 §7). Wraps the 'ws' package (client devDep,
// pinned) with just enough bookkeeping to assert on what the ws client sent, push arbitrary
// frames back, and simulate crashes/restarts for the reconnect tests.
import { WebSocketServer, type WebSocket } from 'ws';

export interface ReceivedFrame {
  type: string;
  payload?: unknown;
  v?: unknown;
}

export interface MockServer {
  port: number;
  url: string;
  /** Every JSON frame received from any client connection, in arrival order. */
  received: ReceivedFrame[];
  /** Currently-open server-side sockets, in connection order. */
  sockets: WebSocket[];
  /** Resolves with the next server-side socket to connect (or an already-open one). */
  nextConnection(): Promise<WebSocket>;
  /** Sends one raw frame (string) or JSON-serializable envelope to every open connection. */
  send(frame: string | object): void;
  /** Terminates open sockets and closes the listener; resolves once fully closed. */
  close(): Promise<void>;
}

export function startMockServer(port = 0): Promise<MockServer> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port });
    const received: ReceivedFrame[] = [];
    const sockets: WebSocket[] = [];
    const connectionWaiters: ((socket: WebSocket) => void)[] = [];

    wss.on('error', reject);

    wss.on('connection', (socket) => {
      sockets.push(socket);
      socket.on('message', (data) => {
        try {
          received.push(JSON.parse(String(data)) as ReceivedFrame);
        } catch {
          received.push({ type: '__unparseable__', payload: String(data) });
        }
      });
      socket.on('close', () => {
        const i = sockets.indexOf(socket);
        if (i !== -1) sockets.splice(i, 1);
      });
      const waiter = connectionWaiters.shift();
      waiter?.(socket);
    });

    wss.on('listening', () => {
      const address = wss.address();
      if (address === null || typeof address === 'string') {
        reject(new Error('mock server: no bound address'));
        return;
      }
      const boundPort = address.port;

      resolve({
        port: boundPort,
        url: `ws://127.0.0.1:${boundPort}`,
        received,
        sockets,
        nextConnection() {
          const open = sockets[sockets.length - 1];
          if (open) return Promise.resolve(open);
          return new Promise((res) => connectionWaiters.push(res));
        },
        send(frame) {
          const text = typeof frame === 'string' ? frame : JSON.stringify(frame);
          for (const socket of sockets) socket.send(text);
        },
        close() {
          return new Promise((res, rej) => {
            for (const socket of sockets) socket.terminate();
            wss.close((err) => (err ? rej(err) : res()));
          });
        },
      });
    });
  });
}

/** Polls `predicate` until it returns true or `timeoutMs` elapses (then rejects). */
export function waitFor(predicate: () => boolean, timeoutMs = 4000, label = 'condition'): Promise<void> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (predicate()) {
        resolve();
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`waitFor timed out: ${label}`));
        return;
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}
