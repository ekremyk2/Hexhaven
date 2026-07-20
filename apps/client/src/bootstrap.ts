// App-startup wiring (T-301): builds the real ws `GameTransport`, registers it as the active
// transport for store actions, and pipes its callbacks into the store. This is the ONLY place the
// ws client and the store meet — components see neither (docs/02 §8: no component reads raw ws).
// Called from main.tsx; tests never import this module (they build their own store + transports).
import { useStore } from './store';
import { setTransport } from './store/transport';
import { createWsTransport } from './ws/client';

let started = false;

export function bootstrapTransport(): void {
  // Vite HMR can re-evaluate the importer; guard so we never stack up parallel sockets.
  if (started) return;
  started = true;

  const transport = createWsTransport({
    onStatusChange: (status) => useStore.getState().setConnectionStatus(status),
  });
  transport.onUpdate((msg) => useStore.getState().applyServerMessage(msg));
  setTransport(transport);
}
