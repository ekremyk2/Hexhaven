// Event constructors for the Helpers-of-Hexhaven events — PM WIRING (done): `helperDealt`/
// `helperUsed`/`helperSwapped` are now real `GameEvent` members (packages/shared/src/types.ts) with
// constructors in the engine's central `events.ts`, exactly like every other module's events. This
// file just re-exports them (plus the `asGameEvent` identity, kept as a no-op alias so no call site
// in this folder needs to change) so `index.ts`/`actions.ts` keep importing from `./events.js`.

import type { GameEvent } from '@hexhaven/shared';

export { helperDealt, helperSwapped, helperUsed } from '../../../events.js';

/** No-op now that these are real `GameEvent` members — kept so existing call sites (`asGameEvent(helperUsed(...))`) don't need touching. */
export function asGameEvent(event: GameEvent): GameEvent {
  return event;
}
