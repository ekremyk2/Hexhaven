// The `GameTransport` interface (T-301 §3, docs/02 §8, D-013) — the only surface store actions
// are allowed to call to reach the network. Two implementations are planned: `src/ws/client.ts`
// (real play, T-301) and a hot-seat adapter that runs the engine in-browser (T-305). Components
// never construct or hold a transport directly — they go through the store (`src/store/index.ts`),
// which is what makes "no component reads raw ws" true.
import type { Action, ClientMessage, ServerMessage } from '@hexhaven/shared';

/** Distributes `Omit` over a union instead of collapsing it to the members' common keys. */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

/** The `lobby.*` subset of `ClientMessage`, with the envelope's `v` stripped (the transport adds
 * it back). This is what a caller of `sendLobby` builds: `{ type: 'lobby.create', payload }`, etc. */
export type LobbyOutboundMessage = DistributiveOmit<
  Extract<ClientMessage, { type: `lobby.${string}` }>,
  'v'
>;

export interface GameTransport {
  send(action: Action): void;
  sendLobby(msg: LobbyOutboundMessage): void;
  sendChat(text: string): void;
  /** Subscribes to parsed, validated inbound server messages. Returns an unsubscribe function. */
  onUpdate(cb: (msg: ServerMessage) => void): () => void;
}

// ---- Registry ----------------------------------------------------------------------------------
// The active transport lives outside zustand state — it owns sockets/timers (imperative resources,
// not serializable app state) — but stays reachable from store action-methods (store/index.ts) so
// they can be "the only thing that calls this" (§3) without every slice needing it threaded
// through. `src/bootstrap.ts` sets it once at app startup; tests set a mock transport per-test.

let currentTransport: GameTransport | null = null;

export function setTransport(transport: GameTransport | null): void {
  currentTransport = transport;
}

export function getTransport(): GameTransport | null {
  return currentTransport;
}
