// Mock `PlayerView`s for the `/styleguide` gallery (visual-cohesion pass): real engine states (not
// hand-built literals — docs/05 §4's "never hand-craft deep state literals" applies here too, even
// though this is a dev-only route, so the fixtures stay honest about what `redact()` actually
// produces). Two scenarios, mirroring why `routes/Game.tsx` never mounts `CardModsComboPanel` for a
// Cities & Knights game (C11.1 — combos consume BASE dev cards, which C&K replaces outright):
//   - `ckStyleguideView`: Cities & Knights + the Helpers of Hexhaven modifier (the two compose freely,
//     `modules/modifiers/registry.ts`'s helpers entry: "no incompatibleWith by design") — covers
//     every citiesKnights/** panel plus HelpersHud.
//   - `modifiersStyleguideView`: a base game with `cardMods` (covers CardModsComboPanel, which is
//     never shown alongside Cities & Knights in the real app either).
import { createGame, redact } from '@hexhaven/engine';
import type { PlayerView } from '@hexhaven/engine';
import type { GameConfig, GameState, HelpersExt, Seat } from '@hexhaven/shared';

const SEAT0 = 0 as Seat;

const BASE: GameConfig = {
  playerCount: 4,
  targetVp: 13,
  seed: 'styleguide',
  board: 'random',
  tokenMethod: 'spiral',
  expansions: { fiveSix: false, seafarers: false, citiesKnights: false },
};

export function ckStyleguideView(): PlayerView {
  const config: GameConfig = {
    ...BASE,
    expansions: { ...BASE.expansions, citiesKnights: true },
    modifiers: { helpers: true },
  };
  const g = createGame(config);
  const ck = g.ext!.citiesKnights!;
  const progressHand = ck.progressHand.map((h, i) => (i === SEAT0 ? [...h, 'irrigation' as const, 'bishop' as const] : h));
  // Deliberately mixed affordability (science affordable, trade/politics not): the gallery should
  // show BOTH of `ImprovementsPanel`'s two mutually-exclusive states at once — the always-visible L3
  // ability caption (science) and the blocked-reason line that takes its place (trade/politics).
  const commodities = ck.commodities.map((c, i) => (i === SEAT0 ? { paper: 5, cloth: 3, coin: 1 } : c));
  const improvements = ck.improvements.map((imp, i) => (i === SEAT0 ? { trade: 3, politics: 1, science: 2 } : imp));
  // A city (not just a settlement) is required to buy ANY improvement level (C4.3) — without one
  // `ImprovementsPanel`'s Buy buttons show a `noCityOwned` reason instead of the L3 ability caption,
  // which would defeat the point of this gallery covering that panel at all.
  const players = g.players.map((p) =>
    p.seat === SEAT0 ? { ...p, cities: [0] as typeof p.cities, resources: { brick: 2, lumber: 1, wool: 0, grain: 3, ore: 2 } } : p,
  );
  // The Helpers of Hexhaven modifier's own `ext.helpers` is only lazily initialized by the engine's
  // first `afterAction` hook (`ensureHelpersExt`, T-905) — a `createGame` state with no action ever
  // dispatched has none yet, which would leave `HelpersHud` rendering nothing in this gallery. Craft
  // one directly (mirrors `ext.citiesKnights` above): seat 0 (the viewer) holds Mayor on side A, seat
  // 1 holds Explorer, seats 2/3 have nothing yet — covers the "your helper" + "another seat's helper"
  // + "no helper yet" cases the panel-clarity pass needs to be checkable here.
  const helpers: HelpersExt = {
    display: ['mendicant', 'robberBride', 'merchant', 'captain', 'noblewoman', 'architect', 'priest', 'general'],
    bySeat: [
      { id: 'mayor', side: 'A', acquiredTurn: g.turn.number - 1 },
      { id: 'explorer', side: 'A', acquiredTurn: g.turn.number - 1 },
      null,
      null,
    ],
    usedThisTurn: [false, false, false, false],
    mayorEligible: [false, false, false, false],
    captainRate: [null, null, null, null],
    architectPeek: [null, null, null, null],
  };
  const state: GameState = {
    ...g,
    players,
    phase: { kind: 'main' },
    turn: { ...g.turn, player: SEAT0, rolled: true, roll: [3, 4] },
    ext: {
      ...g.ext,
      citiesKnights: { ...ck, progressHand, commodities, improvements, barbarian: { ...ck.barbarian, position: 5 } },
      helpers,
    },
  };
  return redact(state, SEAT0);
}

export function modifiersStyleguideView(): PlayerView {
  const config: GameConfig = { ...BASE, modifiers: { cardMods: true } };
  const g = createGame(config);
  // CardModsComboPanel now lists a special play only when its component base cards are IN HAND (a
  // combo is hidden otherwise) — so the gallery seat must hold the full set (incl. 2 knights for
  // Mega Knight) or this panel would render empty. `boughtOnTurn` in the past keeps them playable.
  const prevTurn = g.turn.number - 1;
  const devCards = (['knight', 'knight', 'roadBuilding', 'yearOfPlenty', 'monopoly', 'victoryPoint'] as const).map(
    (type) => ({ type, boughtOnTurn: prevTurn }),
  );
  const players = g.players.map((p) =>
    p.seat === SEAT0
      ? { ...p, resources: { brick: 3, lumber: 2, wool: 1, grain: 2, ore: 1 }, devCards: [...p.devCards, ...devCards] }
      : p,
  );
  const state: GameState = {
    ...g,
    players,
    phase: { kind: 'main' },
    turn: { ...g.turn, player: SEAT0, rolled: true, roll: [5, 2] },
  };
  return redact(state, SEAT0);
}
