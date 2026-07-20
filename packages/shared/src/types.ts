// Game types transcribed from docs/03-data-model.md §3–§5

import type {
  Seat,
  PlayerColor,
  ResourceType,
  DevCardType,
  TerrainType,
  HarborType,
  ResourceBundle,
} from './constants.js';

// Branded ID types (from docs/03 §1.2-1.3)
export type HexId = number & { readonly __hexId: true };
export type VertexId = number & { readonly __vertexId: true };
export type EdgeId = number & { readonly __edgeId: true };

// ---------------------------------------------------------------------------
// Seafarers vocabulary (T-701, docs/rules/seafarers-rules.md).
// Purely ADDITIVE — the base `TerrainType` (constants.ts) is left untouched so every
// `Record<TerrainType, …>` (TERRAIN_RESOURCE, EXT56_TERRAIN_COUNTS, …) and the RK-13 base
// oracle stay bit-identical. These names carry NO engine behavior yet (ships = T-702, gold =
// T-703); they exist so scenario DATA and later phase handlers have a shared type to reference.
// ---------------------------------------------------------------------------

/**
 * Terrain a Seafarers scenario cell can hold: the five base terrains + desert, plus `sea` (S3.1 —
 * produces nothing, only carries ship edges) and `gold` (S9 — owner chooses resources on
 * production). A superset of `TerrainType`; base code never sees `sea`/`gold` (seafarers off).
 */
export type ScenarioTerrain = TerrainType | 'sea' | 'gold';

/**
 * The piece kinds a player can place. `road`/`settlement`/`city` are the base three; `ship` (S3/S4)
 * is RESERVED here for Seafarers and has no engine behavior until T-702. Kept as its own name so
 * events/legal-move code can widen to it later without a base-type change.
 */
export type PieceKind = 'road' | 'settlement' | 'city' | 'ship';

// ---------------------------------------------------------------------------
// Cities & Knights vocabulary (T-801 data-model scaffolding, docs/rules/cities-knights-rules.md).
// Purely ADDITIVE and DORMANT: `citiesKnights` stays `EXPANSION_NOT_AVAILABLE` (modules/index.ts)
// until T-802+ wires real handlers, so this task adds NO `Action` variant and NO `Phase` kind —
// base/fiveSix/seafarers behavior (RK-13) is unaffected. State lives at `state.ext.citiesKnights`
// (C12), mirroring how `ext.seafarers` above never changes base field meaning.
// ---------------------------------------------------------------------------

/** The three commodities (C3.1) — city-only production on forest/pasture/mountains hexes; the sole
 *  currency for city improvements (C4). Never interchangeable with base resources for building. */
export type Commodity = 'paper' | 'cloth' | 'coin';

/** The three city-improvement tracks (C4.1), each bought with one commodity: trade←cloth,
 *  politics←coin, science←paper. */
export type ImprovementTrack = 'trade' | 'politics' | 'science';

/** Knight strength levels (C7.1): 1 basic, 2 strong, 3 mighty. */
export type KnightLevel = 1 | 2 | 3;

/** Traders & Barbarians — Fishermen (T-1002, docs/rules/traders-barbarians-rules.md §TB2.4): the
 *  five one-shot benefits fish may be exchanged for, at the named fixed cost (FISH_EXCHANGE_COST,
 *  modules/tradersBarbarians/fishermen.ts, ⚠ VERIFY the exact ladder against the rulebook). */
export type FishBenefit = 'removeRobber' | 'steal' | 'bankResource' | 'freeRoad' | 'devCard';

/** Traders & Barbarians — the main scenario (T-1006, docs/rules/traders-barbarians-rules.md §TB6.1):
 *  the four commodities the three trade hexes transform (quarry/glassworks/castle). Distinct from
 *  Cities & Knights' `Commodity` (paper/cloth/coin) — never combined (TB8.1's standalone-only guard),
 *  but kept as its own type regardless, same discipline as the T&B knight ACTION names staying
 *  distinct from C&K's own (see the `moveBarbarianKnight` Action variant's header comment). */
export type TBCommodity = 'marble' | 'glass' | 'sand' | 'tools';

/** Explorers & Pirates — ship cargo (T-1102, docs/rules/explorers-pirates-rules.md §EP3.3/§EP4.1/
 *  §EP7.1/§EP8/§EP9): the four small pieces a ship's 2-slot cargo bay may carry, any mix. `crew` and
 *  `settler` are pieces a seat builds and ships elsewhere (EP4.1/EP7.1); `fish`/`spice` are mission
 *  cargo hauled from shoals/villages (EP8/EP9, later tasks). T-1102 owns only the cargo BAY bookkeeping
 *  (load/unload + the 2-piece cap) — which actions actually PRODUCE a crew/settler/fish/spice piece is
 *  T-1104 (buildSettler)/T-1105 (buildCrew)/T-1106 (fish/spice missions)'s own scope. */
export type EPCargo = 'crew' | 'settler' | 'fish' | 'spice';

/**
 * Explorers & Pirates — an exploration-tile reveal outcome (T-1103, §EP5.1: "roll the die — the
 * result maps to a resource terrain, a gold field, a pirate, or nothing", ⚠ VERIFY the exact die
 * face table against the physical rulebook). Drawn from the seeded `explorationSupply` (the "die
 * roll" IS the draw — see `state.ts`'s header). `terrain` mirrors a real land hex (its own number
 * token, R1.1-shaped); `gold` mirrors Seafarers' gold hex (S9 — no token, `seaMap` proxy pattern);
 * `pirate` just records the sighting (combat is T-1105's scope); `nothing` is open water, no land
 * found there after all.
 */
export type EPTile =
  | { kind: 'terrain'; terrain: TerrainType; token: number | null }
  | { kind: 'gold' }
  | { kind: 'pirate' }
  | { kind: 'nothing' };

/** The event die's 6 faces (C5.1): 3 physically-distinct "barbarian ship" faces (collapsed here —
 *  they're indistinguishable in effect, C8.1) and one face per colour/track (C5.2/C6.2). */
export type EventDieFace = 'ship' | ImprovementTrack;

/** A knight board piece (C7.1) at a road-connected intersection. Inactive knights (`active: false`)
 *  do nothing and don't count toward barbarian defense (C7.5/C8.3). */
export interface Knight {
  vertex: VertexId;
  level: KnightLevel;
  active: boolean;
}

/**
 * One literal per distinct progress-card NAME (C6.5) — not per physical copy (e.g. `merchant` has 6
 * copies in the deck but one literal here). 25 distinct names across the 54-card catalog (10 science
 * + 6 trade + 9 politics); `CK_PROGRESS_DECK_COMPOSITION` (constants.ts) carries the per-name copy
 * counts and deck assignment.
 */
export type ProgressCardId =
  // Science / green (10 names, 18 cards)
  | 'alchemist'
  | 'crane'
  | 'engineer'
  | 'inventor'
  | 'irrigation'
  | 'medicine'
  | 'mining'
  | 'printer'
  | 'roadBuilding'
  | 'smith'
  // Trade / yellow (6 names, 18 cards)
  | 'merchant'
  | 'merchantFleet'
  | 'commercialHarbor'
  | 'masterMerchant'
  | 'resourceMonopoly'
  | 'commodityMonopoly'
  // Politics / blue (9 names, 18 cards)
  | 'bishop'
  | 'constitution'
  | 'deserter'
  | 'diplomat'
  | 'intrigue'
  | 'saboteur'
  | 'spy'
  | 'warlord'
  | 'wedding';

/**
 * Cities & Knights expansion state (C12), living at `state.ext.citiesKnights`; present only in a
 * C&K game and dormant/unwired until T-802+. Per-seat fields are arrays indexed by seat, mirroring
 * the `ext.seafarers` `ships`/`shipsLeft` convention above.
 */
export interface CitiesKnightsExt {
  /** Per-seat commodity holdings (C3.1); index = seat. */
  commodities: Record<Commodity, number>[];
  /** Per-seat improvement level per track, 0–5 (C4.1); index = seat. Kept as plain `number` (not a
   *  `0|1|2|3|4|5` literal) so later tasks can increment/compare without per-call casts. */
  improvements: Record<ImprovementTrack, number>[];
  /** Per-seat knight pieces on the board (C7.1); index = seat. */
  knights: Knight[][];
  /** Per-seat city-wall vertices (C9.1); index = seat; length ≤ `CK_MAX_WALLS`. */
  walls: VertexId[][];
  /** Per-seat progress-card hand (C6.3, limit 4 + immediately-revealed VP cards); index = seat. */
  progressHand: ProgressCardId[][];
  /** Per-seat Defender-of-Hexhaven +1 VP count (C8.5); index = seat. */
  defenderVp: number[];
  /** The barbarian ship (C8.1/C8.2): `position` counts ship-symbol advances since the last attack
   *  (resets to 0 after each attack); `attacksResolved` is a running informational total. */
  barbarian: { position: number; attacksResolved: number };
  /** Which seat (if any) holds each track's metropolis (C4.6); `null` until first reached level 4. */
  metropolis: Record<ImprovementTrack, Seat | null>;
  /** The three shuffled progress-card decks (C6.1/C6.5), one draw pile per track/colour. */
  progressDecks: Record<ImprovementTrack, ProgressCardId[]>;
  /** The merchant piece (C6.5 Trade catalog "Merchant"), or `null` while unplaced. Its owner gets
   *  +1 VP while holding it (C1.3/C6.5), fed into `vp.ts`'s `computeVp`. */
  merchant: { hex: HexId; owner: Seat } | null;
  /** C10.1: the robber is locked in the desert until the first barbarian attack resolves. */
  robberLocked: boolean;
  /**
   * T-804/C6.5 Alchemist: the pending forced `[yellow, red]` number-die values for THIS seat's next
   * roll (set by playing Alchemist before rolling), or `null` when no override is pending. Cleared
   * the moment the forced roll is consumed (citiesKnights/index.ts's `handleRollDice`).
   */
  alchemistForced: [number, number] | null;
  /**
   * T-804/C1.3/C6.3: which seat (if any) has revealed each of the two unique +1VP progress cards
   * (Printer/Constitution — one copy each in the whole 54-card deck). These never enter a
   * `progressHand` — they're revealed immediately on draw (C6.3) — so this is the sole record of
   * who holds each bonus VP; `vp.ts`'s `computeVp` reads it directly.
   */
  revealedProgress: Partial<Record<'printer' | 'constitution', Seat>>;
  /**
   * Spy peek reveal (redact.ts hidden-info UX fix): a PENDING two-step Spy play. `peekSpyTarget`
   * (Action below) sets `spyPeek[seat] = { targetSeat, cards }` — a snapshot of `targetSeat`'s real
   * hand at that instant — WITHOUT touching either hand; `redact.ts` then reveals a viewer's own
   * entry (only) in their `PlayerView`, so the acting seat's client can show real card names instead
   * of positional "Card N" before committing via `playProgressCard{card:'spy', targetCard}` (which
   * clears the entry). `null` for every seat with no pending peek — the overwhelming common case, and
   * always true for a non-C&K game's bots/bare-engine callers, who use the pre-existing
   * `targetCard`/`targetCardIndex` one-shot path directly and never touch this field. Index = seat.
   */
  spyPeek: ({ targetSeat: Seat; cards: ProgressCardId[] } | null)[];
}

// ---------------------------------------------------------------------------
// Multi-piece hex framework vocabulary (T-902, docs/07 D-034, docs/tasks/modifiers-RESEARCH.md
// "Design pattern: multiple coexisting hex-pieces"). Generalizes `state.robber` into a collection
// of typed movable hex pieces that coexist alongside it — `wizard` is the ONE reference piece this
// task ships (a beneficial production-hook piece); T-903 widens this union with Trader/Robin Hood/
// Banker/Poaching, each a clean drop-in against the same `HexPieceKind` hook interface
// (modules/modifiers/hexPieces/types.ts).
// ---------------------------------------------------------------------------

/** Every hex-piece KIND the multi-piece framework knows about. Each is independently enabled via
 *  `ModifierConfigMap['hexPieces'].pieces` (docs/tasks/phase-9/PICKS.md "each piece must be usable
 *  STANDALONE") — a game may run any single kind, any subset, or all of them together, always
 *  alongside the (untouched) base robber. T-903 widens the ONE T-902 reference kind (`wizard`) with
 *  four more, each documented in `modules/modifiers/hexPieces/<kind>.ts`:
 *   - `trader` — 3:1 bank-port to adjacent settlements/cities (any owner) + the placer draws 1 on move.
 *   - `robinHood` — on move, redistributes 1 card from the wealthiest seat to the poorest.
 *   - `banker` — its hex produces its resource for whichever seat placed/moved it there (owner-only,
 *     NOT adjacency-based, unlike Wizard/Trader).
 *   - `poaching` — on move, the mover draws 1 of the resource of the hex it moved to.
 */
export type HexPieceKindId = 'wizard' | 'trader' | 'robinHood' | 'banker' | 'poaching';

/** One active hex piece: its kind and current hex (docs/tasks/phase-9/PICKS.md "each enabled piece
 *  starts on the desert with the robber, or a deterministic default hex"). Fully public — like the
 *  robber, a hex piece's position is always visible on the board (never hidden information). */
export interface HexPieceInstance {
  kind: HexPieceKindId;
  hex: HexId;
  /**
   * T-903: which seat, if any, currently "owns" this piece for OWNER-SCOPED effects (the Banker's
   * `onProduction` is the only kind that reads this today). Generic framework field, not a
   * kind-specific special case — `moveHexPiece` (modules/modifiers/hexPieces/index.ts) stamps the
   * mover's seat here on EVERY piece move regardless of kind, mirroring how `hex` itself updates
   * unconditionally. `undefined` until the piece is first moved (lazy placement at game start sets
   * no owner — nobody has "placed" it yet, only the framework's default start-hex logic has).
   */
  owner?: Seat;
}

// ---------------------------------------------------------------------------
// cardMods modifier vocabulary (T-904, docs/tasks/modifiers-cards-RESEARCH.md D1c/D1b). The 6
// curated new dev-card TYPES actually sit in `PlayerState.devCards`/`GameState.devDeck` alongside
// the base 5, so `AnyDevCardId` (NOT `DevCardType` itself, which stays the base-5 alias every
// pre-T-904 `Record<DevCardType, …>` literal already assumes — widening `DevCardType` directly
// would break those literals' exact shape, e.g. `DEV_DECK`/`EXT56_DEV_DECK`'s `toEqual` fixtures)
// is the wider id used by hand/deck fields. The 5 curated COMBO ids (D1b) never sit in a hand or
// the deck at all (each one-shot CONSUMES existing base cards) — they only ever appear as a
// `devPlayed` event's `card` tag for logging, so they widen that one event field instead.
// ---------------------------------------------------------------------------

/** The 6 curated new dev-card TYPES (D1c) mixed into the base 25-card deck when `cardMods` is
 *  enabled. Each is a normal dev card from the player's point of view (drawn blind, subject to
 *  R9.3/R9.4, played via `playCardModCard`). */
export type CardModDevCardId =
  | 'bumperCrop'
  | 'merchantsBoon'
  | 'roadToll'
  | 'trailblazer'
  | 'windfall'
  | 'highwayman';

/** The 5 curated "combined card play" one-shots (D1b, colonist.io house rules): each CONSUMES two
 *  existing base dev cards from hand (or one Victory Point card, for `superSettle`) in a single
 *  `playCardModCombo` action rather than being drawn from the deck itself. */
export type CardModComboId = 'rideByNight' | 'nightOfPlenty' | 'monorail' | 'megaKnight' | 'superSettle';

/** Every id that can occupy a hand slot or a `devDeck` slot: the base 5 plus cardMods' 6 curated
 *  additions. Used ONLY by `PlayerState.devCards`/`GameState.devDeck`/`ModuleConstants.devDeck`/
 *  `devBought`'s event — everywhere else (base dev-card play routing, C&K progress cards, etc.)
 *  keeps using the narrower `DevCardType` unaffected. */
export type AnyDevCardId = DevCardType | CardModDevCardId;

/** Play one of the 6 curated new dev-card types (mirrors `playProgressCard`'s one-flat-action
 *  precedent) — only the fields the named `card` actually reads are ever consulted; per-card field
 *  usage is documented in `packages/engine/src/modules/modifiers/cardMods/newCards.ts`:
 *  bumperCrop (none), merchantsBoon (give/receive), roadToll (resource), trailblazer (edge),
 *  windfall (none), highwayman (hex). */
export interface PlayCardModCardAction {
  type: 'playCardModCard';
  card: CardModDevCardId;
  give?: ResourceType;
  receive?: ResourceType;
  resource?: ResourceType;
  edge?: EdgeId;
  hex?: HexId;
}

/** Play one of the 5 combo cards. Field usage per `combo` (documented in cardMods/comboCards.ts):
 *  rideByNight (edge + hex), nightOfPlenty (resource + hex), monorail (edges), megaKnight
 *  (targetSeat), superSettle (vertex). */
export interface PlayCardModComboAction {
  type: 'playCardModCombo';
  combo: CardModComboId;
  resource?: ResourceType;
  edge?: EdgeId;
  edges?: EdgeId[];
  hex?: HexId;
  vertex?: VertexId;
  targetSeat?: Seat;
}

// ---------------------------------------------------------------------------
// "The Helpers of Hexhaven" modifier vocabulary (T-905, docs/tasks/modifiers-helpers-RESEARCH.md).
// One helper card per seat, dealt as each player places their second setup settlement, each
// granting a special ability fireable at most once per turn-rotation. State lives at
// `state.ext.helpers` (present only when the `helpers` modifier is enabled), mirroring how
// `ext.harbormaster` never changes base field meaning.
// ---------------------------------------------------------------------------

/** One literal per classic Helpers-of-Hexhaven ability (research §2, the 10-power canonical set —
 *  the 2022 reboot's 2 extra powers are out of scope). */
export type HelperId =
  | 'mayor'
  | 'general'
  | 'explorer'
  | 'mendicant'
  | 'robberBride'
  | 'merchant'
  | 'captain'
  | 'noblewoman'
  | 'architect'
  | 'priest';

/** A held helper card + its A/B lifecycle (research §3): fire once (side 'A'), optionally keep it
 *  and fire a second, final time (side 'B'), then it returns to the display and a new one is dealt
 *  automatically. `acquiredTurn` is the `turn.number` this seat most recently received this
 *  PHYSICAL helper — "you can never use a helper the same turn you received it". */
export interface HelperAssignment {
  id: HelperId;
  side: 'A' | 'B';
  acquiredTurn: number;
}

/**
 * `state.ext.helpers` (present only when the `helpers` modifier is enabled), mirroring how
 * `ext.harbormaster` never changes base field meaning.
 */
export interface HelpersExt {
  /** Face-up pool of helpers nobody currently holds, in deal order (front = next dealt). */
  display: HelperId[];
  /** Current assignment per seat, index = seat; `null` before the initial deal reaches that seat. */
  bySeat: (HelperAssignment | null)[];
  /** Per-seat once-per-turn-rotation use guard (research §3); cleared when the turn advances. */
  usedThisTurn: boolean[];
  /** Mayor (research §2): true for one turn-rotation when that seat's most recent roll earned them
   *  0 resources and they haven't yet taken their free card. Cleared on use or the next rotation. */
  mayorEligible: boolean[];
  /** Captain (research §2): the resource this seat may bank-trade at 2:1 for the REST of the
   *  current turn-rotation once activated, or `null`. Cleared on the next rotation. */
  captainRate: (ResourceType | null)[];
  /**
   * Architect peek reveal (redact.ts hidden-info UX fix): a PENDING two-step Architect use.
   * `useHelper{helper:'architect', beginPeek:true}` sets `architectPeek[seat]` to the real top-3
   * `devDeck` card ids at that instant — WITHOUT touching the deck/bank/hand — so `redact.ts` can
   * reveal a viewer's own entry (only) in their `PlayerView`; the client then shows the real cards
   * instead of positional "Card 1/2/3" before committing via the existing
   * `useHelper{helper:'architect', pick, replace, substitute}` action (which clears the entry
   * regardless of whether a peek was ever begun — the commit path is unchanged and still works
   * standalone for bots/tests that never call `beginPeek`). `null` for every seat with no pending
   * peek. Index = seat.
   */
  architectPeek: (readonly AnyDevCardId[] | null)[];
}

/** Every actively-triggered helper's `useHelper` payload (research §2). Mayor/General are the two
 *  "reactive, not player-triggered" abilities EXCEPT Mayor still needs an action to claim the free
 *  card once flagged eligible — General has no action variant at all (fully automatic). */
export type UseHelperAction =
  | { type: 'useHelper'; helper: 'mayor'; resource: ResourceType }
  | { type: 'useHelper'; helper: 'explorer'; from: EdgeId; to: EdgeId }
  | { type: 'useHelper'; helper: 'mendicant'; edge: EdgeId; replace: ResourceType; substitute: ResourceType }
  | { type: 'useHelper'; helper: 'robberBride'; target?: Seat }
  | {
      type: 'useHelper';
      helper: 'merchant';
      targets: Seat[];
      demand: ResourceType;
      giveBack: Partial<Record<Seat, ResourceType>>;
    }
  | { type: 'useHelper'; helper: 'captain'; resource: ResourceType }
  | { type: 'useHelper'; helper: 'noblewoman'; target: Seat }
  // Architect peek reveal (redact.ts hidden-info UX fix): a two-step play split into `beginPeek`
  // (reveals the real top-3 `devDeck` cards to ONLY the acting seat's `PlayerView`, no state change
  // beyond `HelpersExt.architectPeek`) and the pre-existing commit shape below (unchanged — still
  // works standalone, e.g. for bots/tests that never call `beginPeek` at all).
  | { type: 'useHelper'; helper: 'architect'; beginPeek: true }
  | {
      type: 'useHelper';
      helper: 'architect';
      beginPeek?: false;
      pick: 0 | 1 | 2;
      replace: ResourceType;
      substitute: ResourceType;
    }
  | { type: 'useHelper'; helper: 'priest'; build: 'settlement' | 'city'; vertex: VertexId };

/** Voluntarily trade the currently-held helper for a different one from the display (research §3),
 *  WITHOUT spending a use. */
export interface SwapHelperAction {
  type: 'swapHelper';
  take: HelperId;
}

// ---------------------------------------------------------------------------
// Modifiers (T-901, docs/07 D-034, docs/tasks/phase-9/PICKS.md): house-rule / variant RuleModules
// that STACK on top of whichever expansion(s) `GameConfig.expansions` selects — a game is
// (base | 5–6 | Seafarers | C&K) PLUS any chosen modifiers. Purely ADDITIVE: `GameConfig.modifiers`
// absent/empty leaves `resolveModules`/`resolveConstants`/production bit-identical to before this
// field existed (RK-13) — see packages/engine/src/modules/modifiers/registry.ts.
// ---------------------------------------------------------------------------

/**
 * Modifier ids. This union is the ONE place a modifier registers its wire id; wave A–D tasks
 * (T-903a/906/905/904/902, docs/tasks/README.md) add more literals here as they land. Two proof
 * modifiers ship with the framework itself (T-901); `eventCards` shipped its real engine behavior
 * in T-904b (docs/tasks/modifiers-cards-RESEARCH.md D3a) — its compatibility conflict with
 * `citiesKnights` (docs/tasks/phase-9/PICKS.md: "Event Cards ... mutually exclusive with normal
 * dice") was declared earlier, in T-901, ahead of the real build. Wave A-1 (T-903a/906) adds
 * `friendlyRobber`, `playDevSameTurn`, `harbormaster`. T-904/T-905 add `cardMods`/`helpers`.
 */
export type ModifierId =
  | 'customTargetVp'
  | 'combine2sAnd12s'
  | 'eventCards'
  | 'friendlyRobber'
  | 'playDevSameTurn'
  | 'harbormaster'
  | 'cardMods'
  | 'helpers'
  | 'customConstants'
  | 'hexPieces'
  | 'shuffleNumbers'
  | 'hiddenSetupNumbers';

/**
 * Per-modifier config value: the literal `true` for a param-less modifier, a small param payload
 * otherwise (docs/07 D-034) — mirrors `GameConfig.expansions`' per-expansion shape one level up.
 * A new modifier adds exactly one member here alongside its `ModifierId` literal above.
 */
export interface ModifierConfigMap {
  /** Overrides `targetVp` (R13.2) with this VP target — the constant-override archetype. */
  customTargetVp: number;
  /** House rule (docs/tasks/phase-9/PICKS.md "combine 2s & 12s"): a roll of 2 also produces the 12
   *  hexes and vice versa — the production-hook archetype. */
  combine2sAnd12s: true;
  /** OFFICIAL Event Cards (T-904b, docs/tasks/modifiers-cards-RESEARCH.md D3a): a shuffled 36-card
   *  deck (matching the 2d6 distribution) replaces the two dice — draw the top card each turn for
   *  the production total instead of rolling. */
  eventCards: true;
  /** OFFICIAL Friendly Robber (T-903a, docs/07 D-034): the robber/pirate may not steal from a
   *  seat at ≤2 VP, and a 7 rolled during round 1 moves nobody at all (no move, no steal). */
  friendlyRobber: true;
  /** House rule (T-906, docs/07 D-034): waives R9.4's "not bought this same turn" restriction on
   *  playing a development card. */
  playDevSameTurn: true;
  /** OFFICIAL Harbormaster (T-906, docs/07 D-034): +2 VP, held/transferable like Longest Road, for
   *  the seat with the most harbor-building points (settlement 1 / city 2), minimum 3 to claim. */
  harbormaster: true;
  /** House rule (T-904, docs/tasks/modifiers-cards-RESEARCH.md): 6 curated new dev-card types mixed
   *  into the base deck, plus 5 curated "combined card play" one-shots. */
  cardMods: true;
  /** House rule ("The Helpers of Hexhaven", T-905, docs/tasks/modifiers-helpers-RESEARCH.md): one
   *  helper card per seat, each granting a special ability usable at most once per turn-rotation. */
  helpers: true;
  /**
   * The broad "custom game" tunable-constants system (T-906, docs/07 D-034, docs/tasks/phase-9/
   * PICKS.md "NEW — broad customizable constants / custom game system"). Every field is OPTIONAL —
   * an absent field leaves that constant at its base/expansion-resolved default (RK-13 bit-identity
   * when the whole modifier is off, or when a given field is left unset). Each is validated (positive
   * ints, sane bounds) at `resolveModules`/lobby time — see `packages/engine/src/modules/modifiers/
   * customConstants.ts`'s `validateCustomConstantsConfig`.
   */
  customConstants: CustomConstantsConfig;
  /**
   * Multi-piece hex framework (T-902, docs/07 D-034, docs/tasks/phase-9/PICKS.md): which hex-piece
   * KINDS are active this game — each standalone-selectable, so `pieces` may name a single kind or
   * any subset. Non-empty (validated by `validateConfig`, modules/modifiers/hexPieces/index.ts);
   * duplicates are meaningless (each kind has exactly one instance) and rejected the same way.
   */
  hexPieces: { pieces: HexPieceKindId[] };
  /** House rule (board setup): randomize the number-token positions while preserving the exact
   *  count of each number — reuses the R2.5 "shuffled" placement (no two 6/8 adjacent). */
  shuffleNumbers: true;
  /** House rule (blind placement): the hex number tokens stay hidden through the whole initial
   *  settlement/road setup, then are revealed once every player has placed. Redaction-only — the
   *  engine still knows the real numbers; only the client views omit them during setup. */
  hiddenSetupNumbers: true;
}

/**
 * `customConstants`'s per-field config (T-906). A curated-but-extensible set: adding a new tunable
 * is (1) one optional field here, (2) fold it into `ModuleConstants` (packages/engine/src/modules/
 * types.ts), (3) read the resolved constant at its one base call site, (4) one validation line in
 * `validateCustomConstantsConfig`, (5) one input in the client's custom-game params panel.
 */
export interface CustomConstantsConfig {
  /** Each producing settlement/city yields this many times its normal resource count (R5.1). */
  productionMultiplier?: number;
  /** How many free roads (or, in a seafarers game, free roads+ships) Road Building grants (R9.6). */
  roadBuildingCount?: number;
  /** How many resources Year of Plenty grants (R9.7/ER-6, the two-pick `a`/`b` action plus `extra`
   *  picks beyond the first two). */
  yearOfPlentyCount?: number;
  /** A resource bundle granted to EVERY player at game start, on top of the normal empty hand (R1.2). */
  startingResources?: Partial<Record<ResourceType, number>>;
  /** The base 7-discard hand limit (R6.1) — Cities & Knights' per-wall bonus (C9.2) still adds on
   *  top of whatever this sets. */
  discardHandLimit?: number;
  /** Per-item resource-bundle overrides of the base build costs (R7.1/R9.1). Any of the four keys
   *  may be omitted — an omitted item keeps its base cost. */
  costs?: Partial<Record<'road' | 'settlement' | 'city' | 'devCard', Partial<Record<ResourceType, number>>>>;
  /** The bank's starting supply of EACH resource (R1.2's base 19 / fiveSix's 24). */
  bankPerResource?: number;

  // -------------------------------------------------------------------------------------------
  // Configurable LIMITS (docs/07 D-034 "limits + winnability", B-26-adjacent bugfix): every field
  // below is a positive integer OR `null`. `null` is a CLEAN SENTINEL meaning "no cap" (limitless/
  // unbounded) — absent still means "leave the base/expansion-resolved default alone" (RK-13). A
  // `null` resolves to `Infinity` at the ONE seam each reads (`customConstants.ts`), which every
  // build-cap check already compares with a plain `<= 0` / `>= cap` — `Infinity` never trips those,
  // so "limitless" falls out of the existing checks for free, no per-site special-casing needed.
  // -------------------------------------------------------------------------------------------

  /**
   * Overrides the win-condition victory-point target (R13.2) — a second, independently-settable
   * seam alongside the narrower `customTargetVp` modifier (whichever of the two is enabled resolves
   * last wins, `MODIFIER_IDS` order). `null` makes the game ENDLESS: `checkWin` (vp.ts) compares
   * with `<`, so a target of `Infinity` never triggers an automatic winner — the game simply never
   * auto-ends (the host ends it by other means, e.g. agreeing a winner out of band). Absent ⇒ the
   * base/expansion/`customTargetVp`-resolved target, unchanged (RK-13).
   */
  targetVp?: number | null;
  /** Per-player settlement supply cap (R7.3, base 5). `null` ⇒ unlimited — `NO_PIECES_LEFT` never
   *  fires for a settlement build. Absent ⇒ the base 5 (or fiveSix's own, currently identical). */
  maxSettlements?: number | null;
  /** Per-player city supply cap (R7.4/R7.5, base 4). `null` ⇒ unlimited. Absent ⇒ the base 4. */
  maxCities?: number | null;
  /** Per-player road supply cap (R7.2, base 15). `null` ⇒ unlimited. Absent ⇒ the base 15. */
  maxRoads?: number | null;
  /** Cities & Knights per-player city-wall cap (C9.1, base 3). `null` ⇒ unlimited. Ignored (never
   *  read) outside a Cities & Knights game. Absent ⇒ the base `CK_MAX_WALLS` (3). */
  maxCityWalls?: number | null;
  /** Cities & Knights per-LEVEL knight cap (C7.1, base 2 — the same cap applies uniformly to basic/
   *  strong/mighty; the official rule caps each level identically, so one field covers all three).
   *  `null` ⇒ unlimited. Ignored outside a Cities & Knights game. Absent ⇒ the base `CK_KNIGHT_CAP`
   *  (2 per level). */
  maxKnightsPerLevel?: number | null;
  /**
   * Cities & Knights progress-card hand limit (C6.3, base 4 — mirrors the base `discardHandLimit`
   * seam above but for progress cards instead of resources). `null` ⇒ unlimited (a drawn card never
   * auto-discards for being over-hand). Ignored outside a Cities & Knights game. Absent ⇒ the base
   * `CK_PROGRESS_HAND_LIMIT` (4).
   */
  maxProgressCards?: number | null;
}

/** A single modifier's config value, by id (or the union over every id when `K` is left open). */
export type ModifierConfig<K extends ModifierId = ModifierId> = ModifierConfigMap[K];

// GameConfig (docs/03 §3)
export interface GameConfig {
  playerCount: 3 | 4 | 5 | 6;
  targetVp: number;
  seed: string;
  board: 'random' | 'beginner';
  tokenMethod: 'spiral' | 'shuffled';
  expansions: {
    fiveSix: boolean;
    seafarers: false | { scenario: string };
    citiesKnights: boolean;
    /**
     * Traders & Barbarians (Phase 10, docs/rules/traders-barbarians-rules.md §TB1). A COMPILATION —
     * `{ scenario }` selects one of the five T&B scenarios (validated against the shipped set in the
     * engine, like Seafarers). OPTIONAL so every existing config literal stays valid; absent/`false`
     * = off (RK-13 bit-identical). `scenario` is a loose `string` here, narrowed to `TBScenarioId`
     * by the engine module (mirrors `seafarers` above).
     */
    tradersBarbarians?: false | { scenario: string };
    /**
     * Explorers & Pirates (Phase 11, docs/rules/explorers-pirates-rules.md §EP1). `{ scenario }`
     * selects one of the E&P scenarios (validated against the shipped set in the engine). OPTIONAL,
     * absent/`false` = off (RK-13 bit-identical); `scenario` is a loose `string`, narrowed to
     * `EPScenarioId` by the engine module (mirrors `seafarers`/`tradersBarbarians`).
     */
    explorersPirates?: false | { scenario: string };
  };
  /**
   * Rule variants selectable independently of the expansion toggles (docs/10 §4). Optional and
   * fully inert unless its governing expansion is active — omitting it leaves base behavior
   * bit-identical (the RK-13 oracle stays unchanged), so existing base/base-test configs never
   * need to set it.
   */
  variants?: {
    /**
     * 5–6 extension extra-building rule (X12), meaningful ONLY when `expansions.fiveSix` is on:
     * `'sbp'` = 2015 Special Building Phase (default), `'pairedPlayers'` = 2022 Paired Players.
     */
    fiveSixTurnRule?: 'sbp' | 'pairedPlayers';
  };
  /**
   * Enabled modifiers (T-901, docs/07 D-034): a map of modifier id -> its config. Absent/empty
   * leaves engine behavior bit-identical to before this field existed (RK-13). Modifiers compose
   * WITH whichever expansion(s) `expansions` selects — `resolveModules`
   * (packages/engine/src/modules/index.ts) appends each enabled modifier's RuleModule AFTER the
   * expansion module(s), in the fixed `MODIFIER_IDS` order, and rejects a combination the
   * compatibility matrix flags with the coded error `MODIFIER_INCOMPATIBLE`.
   */
  modifiers?: Partial<{ [K in ModifierId]: ModifierConfigMap[K] }>;
}

// HexTile (docs/03 §3)
export interface HexTile {
  terrain: TerrainType;
  token: number | null;
}

// PlayerState (docs/03 §3)
export interface PlayerState {
  seat: Seat;
  color: PlayerColor;
  resources: Record<ResourceType, number>;
  // `AnyDevCardId` (base 5 + cardMods' 6 curated additions, T-904) rather than `DevCardType` —
  // see that type's header comment for why the widening happens here, not on `DevCardType` itself.
  devCards: { type: AnyDevCardId; boughtOnTurn: number }[];
  playedKnights: number;
  piecesLeft: { roads: number; settlements: number; cities: number };
  roads: EdgeId[];
  settlements: VertexId[];
  cities: VertexId[];
}

// Phase (docs/03 §3)
export type Phase =
  | { kind: 'setup'; round: 1 | 2; expect: 'settlement' | 'road'; lastSettlement: VertexId | null }
  | { kind: 'preRoll' }
  | { kind: 'discard'; pending: Seat[]; amounts: Record<Seat, number> }
  | { kind: 'moveRobber'; returnTo: 'preRoll' | 'main' }
  | { kind: 'steal'; candidates: Seat[]; returnTo: 'preRoll' | 'main' }
  // `remaining` is normally 1|2 (R9.6/ER-5's base 2-road allowance) but widens to any positive
  // integer under the `customConstants` modifier's `roadBuildingCount` tunable (T-906, docs/07
  // D-034) — a base/every-expansion game only ever produces 1 or 2 here (RK-13 unaffected).
  | { kind: 'roadBuilding'; remaining: number }
  // Seafarers gold-field production choice (S9/ER-S7): after a roll produces one or more gold hexes,
  // each entitled player picks their free resources here before the turn continues, blocking the
  // turn like `discard` does. `pending` are the seats still owing a choice (any of them may act,
  // like discards); `owed[seat]` is how many free resources that seat must pick (1 per adjacent
  // settlement, 2 per adjacent city). Never occurs in a base game.
  | { kind: 'chooseGoldResource'; pending: Seat[]; owed: Record<Seat, number> }
  | { kind: 'main' }
  // 2015 Special Building Phase (X12) — injected by the fiveSix module between turns. `builder` is
  // the seat currently taking a build-only special turn; `queue` holds the remaining seats (in
  // clockwise order) after them. Never occurs in a base game.
  | { kind: 'specialBuild'; builder: Seat; queue: Seat[] }
  // Caravans camel-placement vote (T-1004, docs/rules/traders-barbarians-rules.md §TB4.2): opened
  // after a `buildSettlement`/`buildCity` completes, blocking the turn like `discard`/
  // `chooseGoldResource` do. `builder` is the seat whose build triggered the vote (also the tie-break
  // winner, ⚠ VERIFY); `pending` are the seats still owing a `caravanVote` bid, builder first. Once
  // `pending` empties, `bids` holds every seat's final (grain+wool) bid and `winner` is resolved: the
  // sole highest bidder, or `builder` on a tie, or `null` if every seat abstained (bid 0) — a `null`
  // winner returns straight to `main` with no camel placed; otherwise `pending` stays `[]` and only
  // `winner` may submit the follow-up `placeCamel`, which returns the phase to `main`. Only ever
  // opened from ordinary `main` play (T-1056 audit: deliberately NOT from a build during the fiveSix
  // SBP sub-phase — see caravans.ts's `maybeOpenCaravanVote`). Never occurs outside a
  // caravans-scenario game.
  | {
      kind: 'caravanVote';
      builder: Seat;
      pending: Seat[];
      bids: Partial<Record<Seat, number>>;
      winner: Seat | null;
    }
  | { kind: 'ended'; winner: Seat };

// GameState (docs/03 §3)
export interface GameState {
  v: 1;
  config: GameConfig;
  rng: number;
  board: {
    hexes: HexTile[];
    robber: HexId;
    harbors: Record<EdgeId, HarborType>;
  };
  bank: Record<ResourceType, number>;
  devDeck: AnyDevCardId[];
  players: PlayerState[];
  turn: {
    number: number;
    player: Seat;
    rolled: boolean;
    roll: [number, number] | null;
    devPlayed: boolean;
    /** Whether a domestic (player-to-player) offer has already been made THIS turn. Set by
     *  `offerTrade`, cleared by `advanceTurn` (a fresh turn object omits it). Bots read it to offer at
     *  most once per turn — the guard that stops the offer→decline→re-offer loop that disabled bot
     *  trades (BUGS.md B-21). Absent ⇒ false; humans are not capped (the client drives them manually). */
    offeredThisTurn?: boolean;
  };
  phase: Phase;
  awards: {
    longestRoad: { holder: Seat | null; length: number };
    largestArmy: { holder: Seat | null; count: number };
  };
  trade:
    | {
        give: ResourceBundle;
        receive: ResourceBundle;
        responses: Partial<Record<Seat, 'accepted' | 'declined'>>;
      }
    | null;
  /**
   * Expansion-owned state (docs/10 §3): base fields never change meaning; each module keeps its own
   * data under `ext.<id>`. Absent in a base game (kept `undefined`, so base serialization/behavior
   * is bit-identical). The fiveSix module uses it to carry a 2022 Paired-Players partial turn.
   */
  ext?: {
    fiveSix?: {
      /** Active 2022 Paired-Players partial turn, or `null` when none is in progress. `builder` is
       *  the paired "player 2"; `resumeFrom` is "player 1" (the seat whose full turn just ended) —
       *  normal rotation resumes from `resumeFrom + 1` once the partial turn ends. */
      partialTurn: { builder: Seat; resumeFrom: Seat } | null;
    };
    /**
     * Seafarers ship state (T-702, docs/rules/seafarers-rules.md §S1/§S3/§S4/§S7). Present only in a
     * seafarers game; base fields never change meaning. Ships are fully PUBLIC (redacted like roads).
     */
    seafarers?: {
      /** Per-seat ship edges (index = seat), exactly like `PlayerState.roads` for roads (S3.2). */
      ships: EdgeId[][];
      /** Per-seat ships remaining in supply (starts 15 — S1.1); index = seat. */
      shipsLeft: number[];
      /** Authoritative per-hex scenario terrain, aligned to `board.hexes` by HexId. `board.hexes[i]`
       *  carries a base-`TerrainType` proxy (`sea`/`gold` → `desert`, producing nothing in T-702) so
       *  base production/render code is untouched; this array is the real classification for ship-edge
       *  detection (S3.1/S3.2) and later gold production (T-703). */
      hexTerrain: ScenarioTerrain[];
      /** `turn.number` on which a ship was last moved (S7.1a: ≤1 move/turn). `-1` = none yet. Only the
       *  turn owner moves ships, so a single global counter is sufficient. */
      movedShipOnTurn: number;
      /** Ships built on the current turn (S7.1b: may not move a ship built this turn). `turn` scopes
       *  `edges` to `turn.number`; a stale `turn` means no ship was built this turn. */
      builtShips: { turn: number; edges: EdgeId[] };
      /** The pirate's current sea hex (S8, T-703). Initialized from `scenario.pirateStart`; moved on a
       *  7 or Knight instead of the robber. Blocks ship build/move on adjacent edges (S8.5) and steals
       *  from adjacent ships' owners (S8.4); never blocks land production. Fully public. */
      pirate: HexId;
      /** Per-seat list of small-island group ids that seat has already earned bonus VP chits for
       *  (S10.6, T-703): index = seat. `+scenario.smallIslandVp` VP per distinct island, the first
       *  time that seat settles it. Fully public (chits sit on the board). */
      islandChits: number[][];
      /**
       * "The Fog Islands" (T-756) fog state — present ONLY for that scenario; every other seafarers
       * game (base Heading for New Shores, New World, ..., and every non-seafarers game) omits this
       * field entirely, so `ext.seafarers` is byte-identical to before this task everywhere else
       * (RK-13-adjacent). Mirrors Explorers & Pirates' `unexplored`/`explorationSupply` SHAPE
       * (`modules/explorersPirates/exploration.ts`) inside this separate module — no shared code
       * (docs/10 §3).
       */
      fog?: {
        /** Hexes still face-down — PUBLIC (only their contents are hidden), mirrors E&P's
         *  `unexplored`. The client renders a fog placeholder over `board.hexes`/`hexTerrain` at
         *  these indices. Shrinks as `modules/seafarers/fog.ts`'s `revealFogAt` reveals hexes. */
        hidden: HexId[];
        /** The HIDDEN shuffled draw pile (terrain+token pairs), seeded once at `createGame`
         *  (`modules/seafarers/board.ts`'s `seedScenarioFog`) via the threaded `rng` — never surfaced
         *  to any player view (`redact.ts` omits this field entirely, the cheat-proof boundary,
         *  mirrors E&P's `explorationSupply`). A reveal pops (shifts) the NEXT entry. */
        stack: { terrain: ScenarioTerrain; token: number | null }[];
      };
      /**
       * "Cloth for Hexhaven" (T-757) cloth counts — present ONLY for that scenario; every other seafarers
       * game (every other scenario, and every non-seafarers game) omits this field entirely, so
       * `ext.seafarers` is byte-identical to before this task everywhere else (RK-13-adjacent, mirrors
       * `fog`'s own isolation). Per-seat cumulative cloth token count (index = seat), granted by
       * `modules/seafarers/cloth.ts`'s `computeClothGains`/`applyClothGains` when a village hex's
       * number rolls (folded into the same dice-roll hook gold production uses). Fully PUBLIC (cloth
       * sits on the board, mirrors `islandChits` above) — `clothVp(seat) = floor(cloth[seat] / 2)`.
       */
      cloth?: number[];
      /**
       * "The Pirate Islands" (T-758) auto-moving pirate track state — present ONLY for that scenario;
       * every other seafarers game omits both fields entirely (RK-13-adjacent, mirrors `cloth`'s own
       * isolation). `pirateTrackIndex` is the current position (index into the scenario board's
       * resolved `pirateTrack`, `modules/seafarers/board.ts`'s `scenarioPirateTrackFor`) — advanced by
       * ONE, wrapping, on every dice roll (`modules/seafarers/pirateTrack.ts`'s `advancePirateTrack`,
       * folded into the same dice-roll hook gold/cloth production use). `pirateTrackSafe` mirrors
       * whether the CURRENT track cell is a `!` (safe) one — when true, `pirate` still sits there (it
       * renders and still counts for the "pirate on a sea hex" invariant) but S8.5 blocking is
       * suppressed for the turn (`modules/seafarers/pirate.ts`'s `edgeBordersPirate`). Both fully
       * PUBLIC (the pirate's position/safety is on-board information, mirrors `pirate` above).
       */
      pirateTrackIndex?: number;
      pirateTrackSafe?: boolean;
      /**
       * "The Pirate Islands" (T-758) captured pirate lairs — present ONLY for that scenario, omitted
       * entirely otherwise (same isolation discipline as `cloth`/`pirateTrackIndex`). Per-seat list
       * (index = seat) of lair hexes THIS seat was first to capture (`modules/seafarers/lairs.ts`'s
       * `grantLairCapture`) by placing a ship or settlement on an edge/vertex touching one — mirrors
       * `islandChits`' per-seat shape above. Fully PUBLIC (a captured lair sits on the board) —
       * `lairVp(seat) = lairs[seat].length * LAIR_VP`.
       */
      lairs?: HexId[][];
      /**
       * "The Wonders of Hexhaven" (T-759) PUBLIC per-seat wonder-stage progress — present ONLY for that
       * scenario, omitted entirely otherwise (same isolation discipline as `cloth`/`pirateTrackIndex`/
       * `lairs`). `wonder[seat]` is how many of `WONDER_STAGES` (`modules/seafarers/wonder.ts`) this
       * seat has completed — derived from pieces they already build (see that file's header for the
       * full model), not a separate purchase action. Completing every stage is an ALTERNATE WIN
       * (`vp.ts`'s `checkWin`, gated strictly on this field's presence).
       */
      wonder?: number[];
    };
    /**
     * Cities & Knights state (T-801 data-model scaffolding, C12). Present only in a C&K game; the
     * module is not yet wired into `resolveModules` (docs/engine/modules/index.ts), so this field
     * is never populated by `createGame` today — dormant until T-802+. Base fields never change
     * meaning.
     */
    citiesKnights?: CitiesKnightsExt;
    /**
     * Traders & Barbarians state (T-1001 data-model scaffolding, docs/rules/traders-barbarians-
     * rules.md §TB8.2). Present only in a T&B game. `scenario` identifies which scenario is active.
     * Base fields never change. T-1002 (Fishermen, §TB2) is the first scenario to actually populate
     * fields beyond `scenario` — the rest (`coins`/`bridges`, `camels`/`oasis`, `barbarians`/
     * `knights`, `wagons`/`tradeHexes`, …) stay dormant until their own per-scenario tasks.
     */
    tradersBarbarians?: {
      scenario: string;
      /**
       * Fishermen (§TB2.3): per-seat fish HAND total (index = seat) — the fish "currency" spent via
       * `exchangeFish`. A v1 simplification: tracked as one aggregate number per seat rather than a
       * list of discrete token values (the data model only ever needs the spendable total); redacted
       * to a per-seat count like the resource hand (§TB8.4) — see redact.ts's header comment on that
       * block for why the "count" and the real total coincide under this simplified model. Present
       * only once the fishermen scenario seeds it (`createGame`).
       */
      fish?: number[];
      /**
       * Fishermen (§TB2.2/§TB2.5): the face-down fish-token draw pile, index 0 = next draw (mirrors
       * `devDeck`). A value 1..3 is that many fish; `0` is the Old Boot tile (§TB2.5). Hidden —
       * OMITTED entirely from redaction (never even a count), like `devDeck`'s contents.
       */
      fishStack?: number[];
      /** Fishermen (§TB2.5): the Old Boot's current holder (public marker — it sits on the table),
       *  or `null` while no boot has been drawn yet / while a leader tie leaves it unclaimed. */
      oldBoot?: Seat | null;
      /** Fishermen (§TB2.1/§TB2.6): the Lake hex — the board's desert hex repurposed as the Lake
       *  (no new board layout; the desert already sits at the board's center, R2, and already never
       *  carries a number token). Produces fish on 2/3/11/12 unless the robber sits there (§TB2.6). */
      lakeHex?: HexId;
      /**
       * Fishermen (§TB2.1, ⚠ VERIFY exact positions — approximate-but-valid placement is acceptable
       * for v1, docs/rules/traders-barbarians-rules.md's explicit allowance): the fishing-ground
       * water tiles, each a number token plus the 2–3 coastal vertices it feeds (§TB2.2). Computed
       * once from the base board's fixed coastline (modules/tradersBarbarians/fishermen.ts) — never
       * random, so it needs no `rng` draw at `createGame`.
       */
      fishingGrounds?: { token: number; vertices: VertexId[] }[];
      /**
       * Rivers (T-1003, docs/rules/traders-barbarians-rules.md §TB2.3/§TB3.1): per-seat gold-coin
       * total (index = seat) — a tradeable, NOT a resource (never spent on builds directly, §TB3.3).
       * Present only once the rivers scenario seeds it (`createGame`). Fully PUBLIC (a tradeable
       * sitting in the open, unlike the hidden resource hand).
       */
      coins?: number[];
      /**
       * Rivers (§TB3.2): per-seat bridge edges (index = seat), mirroring `PlayerState.roads`'s shape.
       * A bridge crosses a river edge (`RIVERS_RIVER_EDGES`) and joins the seat's road network for
       * Longest Road (`rules/longestRoad.ts`), but is tracked separately from `roads` since it isn't
       * drawn from the same named cost/pool as a plain road. Fully PUBLIC (sits on the board).
       */
      bridges?: EdgeId[][];
      /**
       * Rivers (§TB3.3): how many `tradeCoins` trades this seat's turn OWNER has made since the last
       * `endTurn` — gates the 2:1 (first 2 trades) -> 4:1 (rest) rate cliff. Reset to 0 on every
       * `endTurn` (modules/tradersBarbarians/index.ts's `phaseHooks.afterAction`). A single game-wide
       * counter (not per-seat) mirrors `turn.offeredThisTurn`'s "current turn only" scope, since only
       * the turn owner may act in the main phase anyway.
       */
      coinTradesThisTurn?: number;
      /**
       * Rivers (T-1051, 5–6, §TB3.1): THIS game's river edges — computed once at `createGame` from
       * the RESOLVED board geometry (the base 19-hex board, or `GEOMETRY_EXT56`'s 30 hexes for a
       * fiveSix rivers game), so a 5–6 game gets its own river layout laid over its own (bigger)
       * board instead of reusing the base board's fixed edges (which wouldn't even be valid edge ids
       * there). Byte-identical to the base `RIVERS_RIVER_EDGES` module constant for a 3–4p game
       * (same geometry in -> same computed result out, mirroring `fishingGrounds`' T-1050 rework).
       * Present only once the rivers scenario seeds it (`createGame`).
       */
      riverEdges?: EdgeId[];
      /**
       * Rivers (T-1051, 5–6): THIS game's river-shore vertices (the endpoints of `riverEdges`,
       * deduped) — precomputed alongside `riverEdges` from the same resolved geometry, so
       * `isRiverShoreVertex` never needs to re-resolve geometry at read time.
       */
      riverShoreVertices?: VertexId[];
      /**
       * Rivers (T-1051, 5–6): THIS game's river-shore edges (every edge incident to a
       * `riverShoreVertices` member, including the river edges themselves) — precomputed alongside
       * `riverEdges`/`riverShoreVertices` from the same resolved geometry, so `isRiverShoreEdge`
       * never needs to re-resolve geometry at read time either (mirrors fishermen's fully-
       * precomputed `fishingGrounds`, never a live geometry lookup mid-game).
       */
      riverShoreEdges?: EdgeId[];
      /**
       * Caravans (T-1004, docs/rules/traders-barbarians-rules.md §TB4.1): the Oasis hex — the board's
       * desert hex repurposed as the Oasis (no new board layout, same convention as fishermen's
       * `lakeHex`). Present only once the caravans scenario seeds it (`createGame`).
       */
      oasisHex?: HexId;
      /**
       * Caravans (§TB4.1, ⚠ VERIFY exact positions — approximate-but-valid placement is acceptable
       * for v1, docs/rules/traders-barbarians-rules.md's explicit allowance): the caravan-route edges
       * a camel may sit on — three edge-paths radiating from the Oasis, computed once per game from
       * the actual desert hex this board landed on (modules/tradersBarbarians/caravans.ts). Fully
       * PUBLIC (sits on the board, like the robber).
       */
      routeEdges?: EdgeId[];
      /**
       * Caravans (§TB4.1-§TB4.3): placed camel edges (public — camel pieces sit on the board), a
       * subset of `routeEdges`, at most one per edge, length <= the 22-piece supply. A camel-carrying
       * road counts double for Longest Road (`rules/longestRoad.ts`); a settlement/city sitting
       * between two camel-carrying edges scores +1 VP (`modules/tradersBarbarians/caravans.ts`'s
       * `caravansVpFor`, folded into `vp.ts`'s `computeVp`).
       */
      camels?: EdgeId[];
      /**
       * Barbarian Attack (T-1005, docs/rules/traders-barbarians-rules.md §TB5) — ⚠ HIGH-UNCERTAINTY
       * SCENARIO, whole clause flagged ⚠ VERIFY. Barbarian pieces, by the hex each currently
       * occupies (a hex may repeat if two barbarians converge onto it — the small v1 wave rarely
       * does, but nothing forbids it). A SINGLE wave spawns once at `createGame`
       * (`BARBARIAN_START_HEXES`) and is never replenished — the task's "sim MUST terminate"
       * requirement is satisfied structurally (a strictly-shrinking list) rather than via a spawn
       * cap. Present only once the barbarianAttack scenario seeds it.
       */
      barbarians?: HexId[];
      /**
       * Barbarian Attack (T-1052, 5–6, §TB5.2): THIS game's center hex + next-hex march map,
       * computed once at `createGame` from the RESOLVED board geometry (the base 19-hex board, or
       * `GEOMETRY_EXT56`'s 30 hexes for a fiveSix barbarianAttack game), so a 5–6 game gets its own
       * march path laid over its own (bigger) board instead of reusing the base board's fixed hex
       * ids (which wouldn't even be valid there). Byte-identical to the base module constants
       * (`BARBARIAN_CENTER_HEX`/`BARBARIAN_NEXT_HEX`) for a 3–4p game (same geometry in -> same
       * computed result out, mirroring rivers' T-1051 `riverEdges` rework). `barbarianNextHex` is a
       * plain `Record` (JSON-safe), keyed by hex id, mapping to that hex's next hop toward the
       * center — a hex with no entry (the center itself) has nothing further to advance to. Present
       * only once the barbarianAttack scenario seeds it (`createGame`).
       */
      barbarianCenterHex?: HexId;
      barbarianNextHex?: Record<HexId, HexId>;
      /**
       * Barbarian Attack (§TB5.2): T&B knights sitting on PATHS (edges) — a completely separate,
       * non-C&K piece system (§TB5.1, C7 is untouched). `active` gates combat participation
       * (`applyBarbarianAdvance`'s combat check in `modules/tradersBarbarians/barbarianAttack.ts`);
       * recruiting sets it `true`, fighting (on the winning side) or moving sets it `false`. ⚠
       * VERIFY / v1 ADDITION not in the task's literal text: without SOME reactivation, "moving
       * deactivates it" would make a moved knight permanently unable to ever defend again, so a
       * seat's own knights reactivate at the start of THEIR OWN turn (see barbarianAttack.ts's
       * header comment).
       */
      knights?: { seat: Seat; edge: EdgeId; active: boolean }[];
      /**
       * Barbarian Attack (§TB5): per-seat captured-barbarian count (index = seat) — contributes
       * floor(n/2) VP each ("½ VP each", §TB5, ⚠ VERIFY the rounding — `vp.ts`'s
       * `barbarianAttackVpFor`).
       */
      capturedBarbarians?: number[];
      /**
       * Barbarian Attack (§TB5): per-seat gold-coin count (index = seat) — knight-loss / no-
       * barbarian-left-to-capture compensation (`BARBARIAN_GOLD`/`KNIGHT_LOSS_GOLD`). A DIFFERENT
       * currency track from Rivers' `coins` above (never combined — T&B scenarios are standalone
       * per TB8.1), reusing the "gold coin" flavor name only because both are literally coins in
       * the physical game.
       */
      gold?: number[];
      /** Barbarian Attack (§TB5.2): whether the once-per-turn +2-path knight-move extension
       *  (`KNIGHT_MOVE_EXTENDED_RANGE`, 1 grain) has already been used this turn-owner rotation.
       *  Reset on `endTurn` (mirrors Rivers' `coinTradesThisTurn` reset discipline). */
      knightMovedThisTurn?: boolean;
      /**
       * The main scenario (T-1006, docs/rules/traders-barbarians-rules.md §TB6.1): per-seat
       * commodity STOCK (index = seat) — a warehouse of marble/glass/sand/tools, distinct from the
       * base resource hand. Grown by trade-hex production (`applyMainProduction`) and delivery
       * output, spent by `moveWagon{load}` and delivery consumption. Fully PUBLIC (§TB8.4 — no T&B
       * scenario hides this kind of tradeable). Present only once the tradersBarbarians scenario
       * seeds it (`createGame`).
       */
      commodities?: Record<TBCommodity, number>[];
      /**
       * The main scenario (§TB6.2): one wagon per city the owning seat has ever built, appended
       * (never removed) the moment `buildCity` resolves — `at` is its current vertex, `cargo` the
       * single commodity unit it carries (or `null`). Indexed by ARRAY POSITION (`moveWagon.wagon`
       * addresses a wagon by this index, ⚠ VERIFY — see that Action variant's header comment), never
       * reordered/removed once appended. Fully public (a board piece, like the robber).
       */
      wagons?: { seat: Seat; at: VertexId; cargo: TBCommodity | null }[];
      /**
       * The main scenario (§TB6.1, ⚠ VERIFY exact positions — approximate-but-valid placement is
       * acceptable for v1, docs/rules/traders-barbarians-rules.md's explicit allowance): the three
       * trade hexes (quarry/glassworks/castle) and which existing board hex each repurposes. UNLIKE
       * fishermen's Lake / caravans' Oasis, these are NOT the desert (there are three of them and
       * the desert is exactly one hex, R2) — each keeps its own normal terrain/resource production
       * AND additionally produces commodities on its own number roll, a documented v1 double-duty
       * simplification. A fixed module-load constant (`TB_TRADE_HEXES`, `modules/tradersBarbarians/
       * main.ts`), independent of board terrain, so on rare seeds a trade hex may coincide with
       * wherever THIS board's desert landed (permanently dormant there — no token to roll) — a
       * documented v1 edge case, not a bug. Present only once the tradersBarbarians scenario seeds
       * it (`createGame`).
       */
      tradeHexes?: { hex: HexId; kind: 'quarry' | 'glassworks' | 'castle' }[];
      /**
       * The main scenario (§TB6.3, ⚠ VERIFY exact positions — a fixed, evenly-spread module-load
       * constant, same "approximate but documented" allowance as `tradeHexes` above): edges a
       * barbarian piece currently occupies — blocks `buildRoad` there (`PATH_BARBARIAN_BLOCKED`) and
       * costs a wagon's `moveWagon` crossing extra movement points. v1: static (no advance/clearing
       * — TB6.3 flags this as an open question). Fully public (board pieces, like the robber).
       */
      pathBarbarians?: EdgeId[];
      /**
       * The main scenario (§TB6.3): per-seat count of completed trade-hex deliveries (index = seat)
       * — each contributes +1 VP (`vp.ts`'s `computeVp`) on top of the flat gold reward. Fully
       * public (an open tally, like `capturedBarbarians` above). Present only once the
       * tradersBarbarians scenario seeds it (`createGame`).
       */
      deliveries?: number[];
    };
    /**
     * Explorers & Pirates state (T-1101 data-model scaffolding, docs/rules/explorers-pirates-rules.md
     * §EP12.2). Present only in an E&P game; no scenario is shipped yet, so `createGame` never
     * populates it today — dormant until the engine tasks (T-1102+) add their fields (ships+cargo,
     * exploration/fog tile supply, harbor settlements, gold, crew/fish/spice supplies + mission
     * tracks, pirates/villages/shoals). `scenario` identifies which scenario is active.
     *
     * T-1102 (§EP3, the ship-movement + crew/cargo engine — the FIRST E&P engine subsystem) adds the
     * fields below. No scenario ships yet (`SHIPPED_EP_SCENARIOS` stays empty until T-1107's Land
     * Ho!), so `createGame` still never populates this block — T-1102's own tests craft
     * `ext.explorersPirates` directly (`isExplorersPiratesState` gates every handler on ext
     * PRESENCE, not the config toggle, exactly so a foundation task can be tested before any
     * scenario is wired). All fields optional so the T-1101 skeleton type stays a valid subtype.
     */
    explorersPirates?: {
      scenario: string;
      /** Authoritative per-hex sea/gold/land classification (mirrors seafarers'
       *  `ext.seafarers.hexTerrain`), aligned to `board.hexes` by HexId — ship-edge detection (EP3.1/
       *  EP3.2) reads this, never `board.hexes[*].terrain` (which stays a base-terrain PROXY, sea/gold
       *  -> desert, so untouched base render/production code keeps working). Present once a scenario
       *  (or T-1102's own `buildLandHoBoardV0` test board) seeds it. */
      seaMap?: ScenarioTerrain[];
      /** Every ship on the board (EP3, fully public — a board piece like a road/ship). Indexed by
       *  ARRAY POSITION for iteration only — a ship's true identity is its (unique, EP3.1 "one ship
       *  per edge") `edge`, which `moveEPShip`/`loadCargo`/`unloadCargo` address it by (⚠ VERIFY —
       *  mirrors `wagonsOf`'s index-vs-position tradeoff discussion, except here the edge itself is
       *  already a stable, collision-free key so no separate index scheme is needed). `cargo.length`
       *  is capped at `SHIP_CARGO_CAP` (2, EP3.3). */
      ships?: { seat: Seat; edge: EdgeId; cargo: EPCargo[] }[];
      /** Edges a ship was BUILT on THIS turn-owner rotation (EP3.1/EP3.2) — cleared on `endTurn`. A
       *  ship built this turn may not also move it the same turn (⚠ VERIFY, no explicit rulebook
       *  citation found — the same "can't build and move/use the same piece the same turn" discipline
       *  every other movable-piece system in this codebase applies, e.g. seafarers' `builtShips`/T&B's
       *  barbarian-knight `active` flag). */
      shipsBuiltThisTurn?: EdgeId[];
      /** Edges whose ship has already MOVED this turn-owner rotation (EP3.2 "move each ship... per
       *  turn" — read as ≤1 relocation per ship per turn, mirroring Seafarers' S7.1a one-move-per-ship
       *  rule) — cleared on `endTurn`. Tracks the ship's CURRENT (post-move) edge, since a ship's edge
       *  IS its identity (EP3.1: one ship per edge) — a second `moveEPShip` naming that edge as `from`
       *  is rejected regardless of how many hops it has left in `SHIP_MOVE_RANGE`. */
      movedShipsThisTurn?: EdgeId[];
      /** Per-seat gold total (EP6 economy) — index = seat. Seeded to zero per seat once an E&P ext
       *  exists; T-1102 never earns/spends gold itself (no EP3 clause mints or costs gold) — this
       *  field exists now purely so the data model is stable for T-1105/T-1106 (crew/gold rewards) to
       *  extend without a later shape change. Fully public (an open tally, like T&B's own `gold`). */
      gold?: number[];
      /**
       * T-1103 (§EP5.1/§EP12.4): the HIDDEN shuffled draw pile of tile outcomes, seeded once at init
       * (`seedExplorationV0`). A reveal draws (shifts) the NEXT entry — order = the seeded shuffle,
       * mirroring how `devDeck`'s order is the hidden "draw" for dev cards. **Never surfaced to any
       * player view** — `redact.ts`'s `redactExt` omits this field entirely (EP12.4's cheat-proof
       * boundary: the whole point of fog is that no player, including the acting seat, can read the
       * supply's remaining contents/order off the wire).
       */
      explorationSupply?: EPTile[];
      /**
       * T-1103 (§EP2.1/§EP5.1): hexes still face-down (fog) — seeded to every non-home hex at
       * `seedExplorationV0` init (⚠ VERIFY: the real per-scenario frame decides which hexes start
       * pre-explored; this v1 model treats every non-home hex on the T-1102 test board as fog).
       * Shrinks as `moveEPShip` reveals hexes on arrival. PUBLIC — which hexes are still fog is not
       * secret (only their hidden CONTENTS are), so this rides through `redact.ts` unchanged; the
       * client uses it to render fog placeholders over `board.hexes`/`seaMap` at these indices.
       */
      unexplored?: HexId[];
      /**
       * T-1104 (§EP4.2): per-seat harbor settlements — E&P's city-analogue (2 VP each,
       * `vp.ts`'s `computeVp`; E&P has NO cities, `upgradeToHarbor` mirrors `buildCity` but writes
       * here instead of `player.cities`). Indexed by SEAT (`harborSettlements[seat]`), each a plain
       * `VertexId[]` (a settlement upgraded in place — its own vertex never changes). Fully public
       * (a board piece, like a settlement/city). Present once the first harbor settlement is built.
       */
      harborSettlements?: VertexId[][];
      /**
       * T-1104 (§EP4.1): per-seat count of un-loaded settlers — built (`buildEPSettler`, paying
       * `EP_SETTLER_COST`) but not yet drawn onto a ship's cargo bay (`loadCargo{piece:'settler'}`,
       * ships.ts, extended by T-1104 to consume this reserve; `unloadCargo{piece:'settler'}` returns
       * a unit to it — a change of mind, not founding). Indexed by SEAT. ⚠ VERIFY this reserve-pool
       * model against the physical rulebook (settling.ts's header discusses the alternative "fold
       * build+load into one action" reading). Fully public (an open per-seat tally, like `gold`).
       */
      settlerSupply?: number[];
      /**
       * T-1105 (§EP7.1): per-seat count of un-loaded crews — built (`buildEPCrew`, paying
       * `EP_CREW_COST`) but not yet drawn onto a ship's cargo bay (`loadCargo{piece:'crew'}`,
       * ships.ts, extended by T-1105 to consume this reserve, mirroring `settlerSupply` exactly).
       * Indexed by SEAT. Fully public (an open per-seat tally, like `settlerSupply`/`gold`).
       */
      crewSupply?: number[];
      /**
       * T-1105 (§EP7.2): active (not yet captured) pirate lairs — one entry per gold-field hex a
       * revealed `'pirate'` exploration tile placed (`revealOnArrival`, exploration.ts, ⚠ VERIFY:
       * "pirate tiles = lairs on gold fields" — see that file's own T-1105 update). `crews` records,
       * in landing order, which seat placed each of the (up to `LAIR_CAPTURE_CREWS` = 3) crews on
       * this lair; a lair is REMOVED from this list the instant it is captured (⚠ VERIFY —
       * `modules/explorersPirates/pirateLairs.ts`'s own header). Fully public (a board piece, like
       * `harborSettlements`).
       */
      pirateLairs?: { hex: HexId; crews: Seat[] }[];
      /**
       * T-1105 (§EP7.2): per-seat VP earned from CAPTURED lairs only (an active lair's landed crews
       * carry no VP until capture) — index = seat, consumed by `vp.ts`'s `computeVp` (E&P-gated).
       * Fully public (an open per-seat tally), like `gold`/`settlerSupply`.
       */
      lairPoints?: number[];
      /**
       * T-1106 (§EP8, ⚠ VERIFY): sea hexes holding a fish shoal — a ship arriving at (bordering) one
       * of these hexes auto-hauls a `'fish'` cargo unit (folded into `moveEPShip`'s arrival side
       * effect, mirroring `revealOnArrival`'s own "arrival is the trigger" precedent, exploration.ts).
       * Shoals are NOT consumed by a haul in this v1 model (⚠ VERIFY) — fully public (a board feature),
       * seeded once by `seedFishSpiceV0`.
       */
      fishShoals?: HexId[];
      /**
       * T-1106 (§EP9, ⚠ VERIFY): revealed-island hexes holding a native village — a ship adjacent to
       * one may `tradeSpice` there for a `'spice'` cargo unit (paying `SPICE_TRADE_COST_GOLD` gold).
       * Fully public (a board feature), seeded once by `seedFishSpiceV0` on already-revealed land (see
       * `goldFishSpice.ts`'s header for why this differs from the fog-gated `fishShoals`/pirate lairs).
       */
      villages?: HexId[];
      /**
       * T-1106 (§EP8/§EP9): the home-island delivery point both missions ship cargo TO
       * (`deliverFish`/`deliverSpice` require a carrying ship adjacent to this vertex). Seeded once by
       * `seedFishSpiceV0`. Fully public (a fixed board landmark).
       */
      councilVertex?: VertexId;
      /**
       * T-1106 (§EP8, ⚠ VERIFY the flat per-delivery amount — `FISH_VP_PER_DELIVERY`): per-seat VP
       * earned from `deliverFish`. Index = seat, consumed by `vp.ts`'s `computeVp` (E&P-gated). Fully
       * public (an open per-seat tally), like `lairPoints`.
       */
      fishPoints?: number[];
      /**
       * T-1106 (§EP9, ⚠ VERIFY the flat per-delivery amount — `SPICE_VP_PER_DELIVERY`): per-seat VP
       * earned from `deliverSpice`. Index = seat, consumed by `vp.ts`'s `computeVp` (E&P-gated). Fully
       * public, like `fishPoints`.
       */
      spicePoints?: number[];
      /**
       * T-1106 (§EP6.2, ⚠ VERIFY): per-seat VP earned from `shipGold` (spending `GOLD_PER_VP` gold for
       * 1 VP each). Index = seat, consumed by `vp.ts`'s `computeVp` (E&P-gated). Fully public.
       */
      goldPoints?: number[];
      /**
       * T-1106 (§EP9, ⚠ VERIFY the ladder — `SPICE_BENEFIT_MAX_BONUS`): per-seat spice-benefit LEVEL,
       * incremented by 1 on every `deliverSpice` — read by `moveEPShip` (ships.ts) as extra sea-route
       * hops on top of `SHIP_MOVE_RANGE`, capped at `SPICE_BENEFIT_MAX_BONUS` (`goldFishSpice.ts`'s
       * `spiceShipRangeBonus`). Index = seat. Fully public (an open per-seat tally), like `gold`.
       */
      spiceBenefit?: number[];
    };
    /**
     * Harbormaster modifier state (T-906, docs/07 D-034), present only when that modifier is
     * enabled. `points` mirrors `awards.longestRoad.length`'s shape one level up (a held,
     * transferable award) — `holder`'s current harbor-building point total (settlement 1 / city
     * 2), recomputed by `modules/modifiers/harbormaster.ts` after every action.
     */
    harbormaster?: { holder: Seat | null; points: number };
    /**
     * "The Helpers of Hexhaven" modifier state (T-905, docs/tasks/modifiers-helpers-RESEARCH.md),
     * present only when the `helpers` modifier is enabled. Lazily created on the first action the
     * module ever sees (there is no dedicated `initState` hook, docs/10 §3).
     */
    helpers?: HelpersExt;
    /**
     * Event Cards modifier state (T-904b, docs/tasks/modifiers-cards-RESEARCH.md D3a), present only
     * when the `eventCards` modifier is enabled. `deck` is the remaining shuffled cards (index 0 is
     * the next draw, each a 2–12 production total); `discard` accumulates drawn cards and is
     * reshuffled into a fresh `deck` once `deck` empties. Lazily created on the first `rollDice` this
     * modifier ever intercepts (same "no dedicated `initState` hook" substitute `helpers` uses above).
     */
    eventCards?: { deck: number[]; discard: number[] };
    /**
     * Multi-piece hex framework state (T-902, docs/07 D-034, docs/tasks/modifiers-RESEARCH.md),
     * present only when the `hexPieces` modifier is enabled. `pieces` holds one `HexPieceInstance`
     * per enabled kind (docs/tasks/phase-9/PICKS.md "standalone-selectable"). Lazily created on the
     * first action this modifier ever sees (there is no dedicated `initState` hook, docs/10 §3),
     * same substitute `helpers`/`eventCards` use. Fully public (like the robber).
     */
    hexPieces?: { pieces: HexPieceInstance[] };
  };
  stateVersion: number;
}

// Action (docs/03 §4)
export type Action =
  | { type: 'placeSetupSettlement'; vertex: VertexId }
  | { type: 'placeSetupRoad'; edge: EdgeId }
  | { type: 'rollDice' }
  | { type: 'discard'; cards: ResourceBundle }
  | { type: 'moveRobber'; hex: HexId }
  // Seafarers (S8): on a 7 / Knight the mover may relocate the pirate to a sea hex INSTEAD of the
  // robber. Only ever legal in a seafarers game while the `moveRobber` sub-phase is open; the module
  // intercepts it (a base game rejects it).
  | { type: 'movePirate'; hex: HexId }
  // Multi-piece hex framework (T-902, docs/07 D-034): "move-any" — while the `hexPieces` modifier
  // is active and the `moveRobber` sub-phase is open, the mover may move a NAMED hex piece INSTEAD
  // of the base robber (`moveRobber` above, untouched). Exactly one piece move OR one robber move
  // per 7/Knight: whichever the mover submits first consumes the sub-phase (the module's
  // `interceptAction` returns the phase to `main`/`preRoll` exactly like `moveRobberHandler` does),
  // so the other action is no longer legal afterward (`WRONG_PHASE`). Only ever legal when
  // `hexPieces` is enabled and `piece` names a currently-active kind (the module intercepts it); a
  // game without the modifier rejects it.
  | { type: 'moveHexPiece'; piece: HexPieceKindId; hex: HexId }
  | { type: 'steal'; from: Seat }
  | { type: 'buildRoad'; edge: EdgeId }
  | { type: 'buildSettlement'; vertex: VertexId }
  | { type: 'buildCity'; vertex: VertexId }
  // Seafarers (S4/S7, T-702): build a ship on a sea edge, or relocate one open-ended ship.
  // Only ever legal in a seafarers game (the module intercepts them); a base game rejects both.
  | { type: 'buildShip'; edge: EdgeId }
  | { type: 'moveShip'; from: EdgeId; to: EdgeId }
  // Seafarers (S9/ER-S7): a player's gold-field free-resource choice, submitted during the
  // `chooseGoldResource` sub-phase. `picks` must sum to the seat's owed count (bank permitting).
  // Only ever legal in a seafarers game (the module handles it); a base game rejects it.
  | { type: 'chooseGoldResource'; picks: ResourceBundle }
  // Seafarers (S11.1): a free SHIP placement during Road Building — the 2 free pieces may each be a
  // road (`placeFreeRoad`) or a ship. Only ever legal in a seafarers game's `roadBuilding` sub-phase.
  | { type: 'placeFreeShip'; edge: EdgeId }
  | { type: 'buyDevCard' }
  | { type: 'playKnight' }
  | { type: 'playRoadBuilding' }
  | { type: 'placeFreeRoad'; edge: EdgeId }
  // `extra` is ADDITIVE-ONLY (T-906, docs/07 D-034 `customConstants.yearOfPlentyCount`): a base
  // game (count 2, the default) never reads it — `a`/`b` alone stay bit-identical (RK-13). When
  // the modifier configures a count > 2, `extra` carries the picks beyond the first two (its
  // length must equal `count - 2`, enforced engine-side with `BAD_YOP_COUNT`).
  | { type: 'playYearOfPlenty'; a: ResourceType; b: ResourceType; extra?: ResourceType[] }
  | { type: 'playMonopoly'; resource: ResourceType }
  | { type: 'bankTrade'; give: ResourceType; receive: ResourceType }
  | { type: 'offerTrade'; give: ResourceBundle; receive: ResourceBundle }
  | { type: 'respondTrade'; response: 'accept' | 'decline' }
  | { type: 'confirmTrade'; with: Seat }
  | { type: 'cancelTrade' }
  | { type: 'endTurn' }
  // 5–6 extension (X12): the extra builder yields — ends an SBP special-build turn (2015) or a
  // Paired-Players partial turn (2022). Only ever legal while the fiveSix module's extra-build
  // state is active; a base game never accepts it.
  | { type: 'passSpecialBuild' }
  // Cities & Knights (T-802, C4.1/C4.2): advance one city-improvement track by exactly one level,
  // paying that track's commodity cost to the bank. Only ever legal in a C&K game (the module
  // intercepts it); a base game rejects it.
  | { type: 'buildImprovement'; track: ImprovementTrack }
  // Cities & Knights (T-802, C4.5 Trade-L3 Trading House): trade a commodity for a resource or
  // another commodity, 2:1 with Trading House else the base 4:1 (commodities have no harbors).
  // Only ever legal in a C&K game (the module intercepts it); a base game rejects it.
  | { type: 'commodityBankTrade'; give: Commodity; receive: ResourceType | Commodity }
  // Cities & Knights (T-803, C7.1/C7.2): build a basic knight (1 wool + 1 ore) on a road-connected
  // (distance rule N/A) empty-of-knights intersection. Placed inactive. Main phase only.
  | { type: 'buildKnight'; vertex: VertexId }
  // Cities & Knights (T-803, C7.2): activate an inactive knight (1 grain). Main phase only.
  | { type: 'activateKnight'; vertex: VertexId }
  // Cities & Knights (T-803, C7.2/C7.3): promote a knight one level (1 wool + 1 ore).
  // strong->mighty requires Politics-L3 Fortress (C4.5). Main phase only.
  | { type: 'promoteKnight'; vertex: VertexId }
  // Cities & Knights (T-803, C7.4): move an ACTIVE knight to another vertex reachable over the
  // seat's own road network (may pass through the seat's own pieces); deactivates the knight.
  | { type: 'moveKnight'; from: VertexId; to: VertexId }
  // Cities & Knights (T-803, C7.4): an ACTIVE knight displaces a strictly weaker opponent knight
  // sitting on a road-connected vertex; deactivates the mover.
  | { type: 'knightDisplace'; from: VertexId; to: VertexId }
  // Cities & Knights (T-803, C7.4/C10.2): a knight adjacent to the robber's hex moves it (+ steals,
  // base R6) instead of the moveRobber sub-phase. Only legal after the first barbarian attack.
  | { type: 'chaseRobber'; knightVertex: VertexId; toHex: HexId; stealFrom?: Seat }
  // Cities & Knights (T-804, C9.1/C6.5 Engineer): build a city wall (2 brick) under one of your own
  // cities; Engineer plays it free (see `playProgressCard` below), a direct action costs 2 brick.
  | { type: 'buildCityWall'; vertex: VertexId }
  // Cities & Knights (T-804, C6.4/C6.5): play a progress card from hand. Legal only after rolling in
  // the main phase, EXCEPT Alchemist (before rolling, in preRoll — C6.4). Every optional field below
  // is a per-card parameter; only the fields the named card actually reads are ever consulted (the
  // module intercepting this action validates per-card, docs/rules/cities-knights-rules.md C6.5) —
  // one flat discriminated-by-`card` shape keeps the wire contract simple (single zod schema) at the
  // cost of "some fields are meaningless for some cards", documented card-by-card in progressCards.ts.
  | {
      type: 'playProgressCard';
      card: ProgressCardId;
      /** Alchemist: the forced yellow/red number-die values for this seat's next roll (1-6 each). */
      yellowDie?: number;
      redDie?: number;
      /** Crane: which improvement track to advance at a 1-commodity discount. */
      track?: ImprovementTrack;
      /** Engineer (city-wall vertex) / Medicine (settlement->city vertex) / Deserter (where YOUR
       *  replacement knight is placed). */
      vertex?: VertexId;
      /** Merchant (hex to place the merchant on) / Bishop (robber's destination hex). */
      hex?: HexId;
      /** Inventor: the two hexes whose number tokens are swapped. */
      hexA?: HexId;
      hexB?: HexId;
      /** Merchant Fleet: the one-shot 2:1 trade this turn (give -> receive, either resource or
       *  commodity on either side). */
      give?: ResourceType | Commodity;
      receive?: ResourceType | Commodity;
      /** Resource Monopoly / Commercial Harbor's resource leg. */
      resource?: ResourceType;
      /** Commodity Monopoly / Commercial Harbor's commodity leg. */
      commodity?: Commodity;
      /** Master Merchant / Deserter / Intrigue(n/a) / Spy: the opposing seat targeted. */
      targetSeat?: Seat;
      /** Deserter (opponent's knight to remove) / Intrigue (opponent's knight to displace). */
      targetVertex?: VertexId;
      /** Spy: which of the target's progress cards to take, by card id — used when the caller can
       *  see the target's hand (bots/tests over a determinized full state). */
      targetCard?: ProgressCardId;
      /** Spy (T-806): the POSITION of the card to take in the target's hand. The human client can't
       *  see the opponent's hidden hand (redact.ts hides card identities), so it selects by index
       *  instead of `targetCard`. When both are absent Spy fails; `targetCard` takes precedence. */
      targetCardIndex?: number;
      /** Diplomat: the open road edge to remove. */
      edge?: EdgeId;
    }
  // Spy peek reveal (redact.ts hidden-info UX fix, C6.5): the "begin" half of a two-step Spy play —
  // reveals `targetSeat`'s real progress-card hand to ONLY the acting seat's `PlayerView`
  // (`CitiesKnightsExt.spyPeek`), without removing/moving any card. The client then re-dispatches
  // the pre-existing `playProgressCard{card:'spy', targetSeat, targetCard}` (unchanged) to commit,
  // now naming a REAL card id instead of a position. Only ever legal in a C&K game while `seat` holds
  // 'spy' in hand (the module intercepts it; a base game rejects it).
  | { type: 'peekSpyTarget'; targetSeat: Seat }
  // cardMods modifier (T-904, docs/tasks/modifiers-cards-RESEARCH.md): only ever legal when the
  // `cardMods` modifier is enabled (the module intercepts them); a game without it rejects both.
  | PlayCardModCardAction
  | PlayCardModComboAction
  // "The Helpers of Hexhaven" modifier (T-905): only ever legal when the `helpers` modifier is
  // enabled (the module intercepts them); a game without it rejects both.
  | UseHelperAction
  | SwapHelperAction
  // Traders & Barbarians — Fishermen (T-1002, docs/rules/traders-barbarians-rules.md §TB2.4/§TB2.5).
  // Only ever legal in a fishermen-scenario game (the module intercepts both); a game without that
  // scenario active rejects them.
  | {
      type: 'exchangeFish';
      benefit: FishBenefit;
      /** 'steal' (3 fish, §TB2.4): the adjacent-to-the-robber seat to steal 1 random resource from —
       *  same candidate set as a normal robber steal (R6.3/ER-3). */
      from?: Seat;
      /** 'bankResource' (4 fish, §TB2.4): the resource taken from the bank. */
      resource?: ResourceType;
      /** 'freeRoad' (5 fish, §TB2.4): the edge the free road is built on (same legality as a normal
       *  road, R7.2 — occupancy + connectivity). */
      edge?: EdgeId;
    }
  // Traders & Barbarians — Fishermen (T-1002, §TB2.5): the Old Boot holder passes it to an opponent
  // they are trailing or tied with. Only ever legal for the current holder in a fishermen game.
  | { type: 'passOldBoot'; to: Seat }
  // Traders & Barbarians — Rivers (T-1003, docs/rules/traders-barbarians-rules.md §TB3.2): build a
  // bridge across a river edge (2 brick + 1 lumber, `RIVERS_BRIDGE_COST`) — legal only on a
  // `RIVERS_RIVER_EDGES` edge, with normal road connectivity (R7.2) at an endpoint. Bridges draw
  // from their OWN supply, not the seat's road-piece pool (the fixed river-edge set is itself the
  // cap). Only ever legal in a rivers-scenario game (the module intercepts it); a game without that
  // scenario active rejects it.
  | { type: 'buildBridge'; edge: EdgeId }
  // Traders & Barbarians — Rivers (T-1003, §TB3.3): trade gold coins for one bank resource. `give`
  // must equal the CURRENT rate (2 coins for the first two coin trades this turn-owner rotation, 4
  // thereafter, §TB3.3) — the engine rejects a `give` that doesn't match the resolved rate. Only
  // ever legal in a rivers-scenario game.
  | { type: 'tradeCoins'; give: number; receive: ResourceType }
  // Traders & Barbarians — Caravans (T-1004, docs/rules/traders-barbarians-rules.md §TB4.2): a bid
  // in the camel-placement vote, submitted by any seat still in the `caravanVote` phase's `pending`
  // list (builder included). `{ grain: 0, wool: 0 }` abstains. Paid to the bank immediately regardless
  // of who ends up winning the vote — capped at the seat's actual grain/wool holdings. Only ever
  // legal in a caravans-scenario game while the vote is open.
  | { type: 'caravanVote'; grain: number; wool: number }
  // Traders & Barbarians — Caravans (§TB4.2): the vote's resolved winner places one camel on an
  // empty caravan-route edge (`ext.tradersBarbarians.routeEdges`). Only ever legal for that winner,
  // only once the vote's `pending` list is empty.
  | { type: 'placeCamel'; edge: EdgeId }
  // Traders & Barbarians — Barbarian Attack (T-1005, docs/rules/traders-barbarians-rules.md §TB5).
  // Only ever legal in a barbarianAttack-scenario game (the module intercepts both); a game
  // without that scenario active rejects them. Distinct action NAMES from Cities & Knights' own
  // `buildKnight`/`moveKnight`/`activateKnight` (C7) — this is a separate, non-C&K knight system
  // (§TB5.1) that is never combined with C&K (TB8.1's standalone-only guard), but sharing an
  // `Action` tag with a differently-shaped C&K payload would still be unsafe, so every T&B knight
  // action keeps its own unique tag regardless.
  // §TB5.2 (⚠ VERIFY "castle-edge" placement — v1: any edge touching the seat's own road network,
  // R7.2, `isRoadConnected`): recruit a new knight onto an unoccupied edge, `KNIGHT_COST`.
  | { type: 'recruitKnight'; edge: EdgeId }
  // §TB5.2: move an ACTIVE knight from one edge to another up to `KNIGHT_MOVE_RANGE` paths away
  // (edge-adjacency hops); `extended: true` spends the once-per-turn `KNIGHT_MOVE_EXTEND_COST_GRAIN`
  // grain to reach up to `KNIGHT_MOVE_EXTENDED_RANGE` instead (only one such extension per
  // turn-owner rotation, `knightMovedThisTurn`). Moving deactivates the knight (⚠ VERIFY — see
  // `knights` field's header comment on the v1 reactivation-timing addition this implies).
  | { type: 'moveBarbarianKnight'; from: EdgeId; to: EdgeId; extended?: boolean }
  // Traders & Barbarians — the main scenario (T-1006, docs/rules/traders-barbarians-rules.md §TB6.2/
  // §TB6.3): move `wagon` (an index into `ext.tradersBarbarians.wagons`, ⚠ VERIFY — the task's data
  // model names either an index or a `VertexId`; an index is simpler/stable since a seat may end up
  // with two wagons sharing a vertex) along a connected `path` of edges, spending movement points
  // (`WAGON_MP_PER_TURN`) per §TB6.2's road/toll/barbarian cost table. `path: []` is a legal
  // "stay in place" call — a v1 addition (not forbidden by the rulebook) that lets a stationary wagon
  // load without wasting a turn. `load`, when set, auto-loads that commodity from the seat's stock
  // the moment the wagon DEPARTS its current vertex, but only when that vertex is one of the seat's
  // own settlements/cities and the wagon's cargo slot is empty (§TB6.2's "keep it simple" fold-in);
  // delivery to a served trade hex the path ends adjacent to is automatic (§TB6.3), no separate
  // action. Only ever legal in the tradersBarbarians-scenario game (the module intercepts it); a game
  // without that scenario active rejects it.
  | { type: 'moveWagon'; wagon: number; path: EdgeId[]; load?: TBCommodity }
  // ---- Explorers & Pirates — ship movement + crew/cargo (T-1102, docs/rules/
  // explorers-pirates-rules.md §EP3). Only ever legal in an E&P game (the module's
  // `interceptAction` gates on `isExplorersPiratesState`, ext PRESENCE rather than the config
  // toggle — no scenario ships yet, T-1107). ---------------------------------------------------
  // EP3.1: build a ship (`EP_SHIP_COST`, ⚠ VERIFY provisional 1 wool + 1 lumber) on a sea route
  // touching the seat's own coastal settlement/city or another of their ships (v1 harbor
  // substitute, ⚠ VERIFY — harbor settlements are T-1104's own scope).
  | { type: 'buildEPShip'; edge: EdgeId }
  // EP3.2: relocate the ship on `from` to `to`, up to `SHIP_MOVE_RANGE` (⚠ VERIFY provisional 4)
  // sea-route hops away (a reachability search over sea-edge adjacency, not a submitted path —
  // mirrors Seafarers' `moveShip`'s from/to shape, widened by the longer E&P range). Rejected if
  // `from`'s ship was built this turn (⚠ VERIFY) or has already moved this turn (≤1/turn).
  | { type: 'moveEPShip'; from: EdgeId; to: EdgeId }
  // EP3.3: load one cargo piece onto the ship at `ship` (its edge) from the seat's own coastal
  // settlement/city (v1 harbor substitute, ⚠ VERIFY — see `buildEPShip`'s note); rejected once the
  // ship's cargo bay already holds `SHIP_CARGO_CAP` (2) pieces. T-1102 owns only the cargo BAY
  // bookkeeping — which action actually PRODUCES a crew/settler/fish/spice piece to load is later
  // tasks' scope (T-1104/T-1105/T-1106).
  | { type: 'loadCargo'; ship: EdgeId; piece: EPCargo }
  // EP3.3: the load inverse — removes one `piece` from the ship at `ship`'s cargo bay (same v1
  // harbor-substitute location rule as `loadCargo`).
  | { type: 'unloadCargo'; ship: EdgeId; piece: EPCargo }
  // ---- Explorers & Pirates — settlers, founding & harbor settlements (T-1104, docs/rules/
  // explorers-pirates-rules.md §EP4). Only ever legal in an E&P game (same `interceptAction` gate
  // as the T-1102/T-1103 actions above). ---------------------------------------------------------
  // EP4.1: pay `EP_SETTLER_COST` (⚠ VERIFY provisional 1 grain + 1 wool) to add one settler to the
  // seat's reserve (`ext.explorersPirates.settlerSupply`) — not yet on any ship.
  | { type: 'buildEPSettler' }
  // EP4.1: a ship carrying a `'settler'` cargo unit adjacent to `vertex` (an unoccupied, distance-
  // rule-legal coast touching DISCOVERED land, not the fog) unloads it and founds a real settlement
  // there — free (the settler WAS the cost); ⚠ VERIFY whether founding needs a road/connection (v1:
  // no, reached by ship — settling.ts's header).
  | { type: 'foundSettlement'; vertex: VertexId }
  // EP4.2: upgrade the seat's OWN settlement at `vertex` to a harbor settlement — E&P's city-
  // analogue (2 VP, no cities exist in E&P) — for `EP_HARBOR_COST` (⚠ VERIFY provisional 2 ore + 1
  // grain, the base city-cost analogue); mirrors `buildCity`'s own replace-in-place mechanics.
  | { type: 'upgradeToHarbor'; vertex: VertexId }
  // ---- Explorers & Pirates — crews & the Pirate Lairs mission (T-1105, docs/rules/
  // explorers-pirates-rules.md §EP7). Only ever legal in an E&P game (same `interceptAction` gate
  // as the T-1102/T-1103/T-1104 actions above). -----------------------------------------------
  // EP7.1: pay `EP_CREW_COST` (⚠ VERIFY provisional 1 ore + 1 wool) to add one crew to the seat's
  // reserve (`ext.explorersPirates.crewSupply`) — requires owning at least one harbor settlement
  // (⚠ VERIFY the anchor; `modules/explorersPirates/settling.ts`'s harbor settlements, T-1104).
  | { type: 'buildEPCrew' }
  // EP7.2: a ship carrying a `'crew'` cargo unit adjacent to `hex` (an active pirate lair) lands
  // ONE crew there; the 3rd crew landed (any seats) captures the lair and scores lair-capture VP
  // (⚠ VERIFY the 1-3 split — `modules/explorersPirates/pirateLairs.ts`'s own header documents the
  // v1 decision).
  | { type: 'placeCrewOnLair'; hex: HexId }
  // ---- Explorers & Pirates — fish/spice missions & the gold economy (T-1106, docs/rules/
  // explorers-pirates-rules.md §EP6/§EP8/§EP9). Only ever legal in an E&P game (same
  // `interceptAction` gate as the T-1102…T-1105 actions above). -------------------------------
  // EP6.2: spend `GOLD_PER_VP` (⚠ VERIFY provisional 3) gold for 1 VP (`goldPoints[seat] += 1`) —
  // no location requirement (⚠ VERIFY — `goldFishSpice.ts`'s header explains why this is modeled as
  // a flat-fee-anywhere action, not a delivery, mirroring `exchangeFish`).
  | { type: 'shipGold' }
  // EP9: a ship of the acting seat adjacent to `hex` (an active village) pays `SPICE_TRADE_COST_GOLD`
  // (⚠ VERIFY) gold to load one `'spice'` cargo unit.
  | { type: 'tradeSpice'; hex: HexId }
  // EP8: a ship carrying a `'fish'` cargo unit adjacent to `councilVertex` delivers it for
  // `FISH_VP_PER_DELIVERY` (⚠ VERIFY) VP.
  | { type: 'deliverFish' }
  // EP9: a ship carrying a `'spice'` cargo unit adjacent to `councilVertex` delivers it for
  // `SPICE_VP_PER_DELIVERY` (⚠ VERIFY) VP, and raises the seat's `spiceBenefit` level by 1 (wired
  // into `SHIP_MOVE_RANGE`, ⚠ VERIFY the ladder — `goldFishSpice.ts`'s header).
  | { type: 'deliverSpice' };

// Engine error codes (docs/03 §4)
export type EngineErrorCode =
  | 'NOT_YOUR_TURN'
  | 'WRONG_PHASE'
  | 'ALREADY_ROLLED'
  | 'MUST_ROLL_FIRST'
  | 'CANT_AFFORD'
  | 'NO_PIECES_LEFT'
  | 'BAD_LOCATION'
  | 'DISTANCE_RULE'
  | 'NOT_CONNECTED'
  | 'OCCUPIED'
  | 'BANK_EMPTY'
  | 'DECK_EMPTY'
  | 'DEV_ALREADY_PLAYED'
  | 'DEV_BOUGHT_THIS_TURN'
  | 'CARD_NOT_HELD'
  | 'BAD_TRADE'
  | 'NO_OPEN_OFFER'
  | 'NOT_A_CANDIDATE'
  | 'BAD_DISCARD_COUNT'
  // Seafarers gold (S9/ER-S7): the submitted gold picks don't sum to the seat's owed count (bank
  // permitting) — the gold analogue of BAD_DISCARD_COUNT.
  | 'BAD_GOLD_COUNT'
  | 'ROBBER_SAME_HEX'
  | 'CANNOT_PLAY'
  | 'EXPANSION_NOT_AVAILABLE'
  // T-901 (docs/07 D-034): the requested `config.modifiers` combination trips the compatibility
  // matrix — either against an active expansion, or against another requested modifier.
  | 'MODIFIER_INCOMPATIBLE'
  | 'GAME_OVER'
  // Cities & Knights (T-802, C4.3): buildImprovement requires owning at least one city.
  | 'NO_CITY_OWNED'
  // Cities & Knights (T-802, C4.1): a track is already at level 5, the top of its track.
  | 'IMPROVEMENT_MAX_LEVEL'
  // ---- Cities & Knights knights/barbarians (T-803) ----------------------------------------
  | 'KNIGHT_NOT_FOUND'
  | 'KNIGHT_INACTIVE'
  | 'KNIGHT_ALREADY_ACTIVE'
  // C7.1: the seat already has the max pieces (2) at the target level.
  | 'KNIGHT_CAP'
  // C7.1: a knight is already at mighty (3), the top level.
  | 'KNIGHT_MAX_LEVEL'
  // C7.4: displacement requires the target knight to be strictly weaker than the mover.
  | 'NOT_STRONGER'
  // C4.5/C7.3: strong->mighty promotion requires Politics-L3 Fortress.
  | 'FORTRESS_REQUIRED'
  // C10.1/C10.2: the robber is locked (no first barbarian attack yet) — no move/steal/chase.
  | 'ROBBER_LOCKED'
  // ---- Cities & Knights progress cards (T-804) --------------------------------------------
  // C11.1: base dev-card actions (buy/play) are disabled in a Cities & Knights game — progress
  // cards replace the dev deck entirely.
  | 'DEV_CARDS_DISABLED'
  // A card's named target doesn't satisfy its own eligibility rule (e.g. Master Merchant/Wedding
  // require the target to hold strictly more VP than the acting seat).
  | 'NOT_ELIGIBLE'
  // A card's named target (vertex/edge/hex/seat/card) is missing, malformed, or doesn't hold what
  // the card requires there (e.g. Spy naming a card the target doesn't hold).
  | 'BAD_CARD_TARGET'
  // C9.1: a seat already has the max (3) city walls.
  | 'WALL_CAP'
  // C9.1: the named city already has a wall (one per city).
  | 'WALL_ALREADY_BUILT'
  // C6.5 Inventor: may not relocate the number token on a 6 or 8 hex.
  | 'INVENTOR_RESTRICTED_NUMBER'
  // T-906 (docs/07 D-034 `customConstants`): a `config.modifiers.customConstants` field failed
  // its own range/shape validation (e.g. a non-positive count, starting resources exceeding the
  // resolved bank supply) — rejected the same way `MODIFIER_INCOMPATIBLE` rejects a matrix conflict,
  // before any module is built.
  | 'MODIFIER_INVALID_CONFIG'
  // T-906 (docs/07 D-034 `customConstants.yearOfPlentyCount`): the submitted `playYearOfPlenty`
  // action's `a`/`b` + `extra` picks don't total the resolved count.
  | 'BAD_YOP_COUNT'
  // ---- Multi-piece hex framework (T-902, docs/07 D-034) -----------------------------------
  // `moveHexPiece` named a kind that isn't currently active (the `hexPieces` modifier is off, or
  // enabled without that kind).
  | 'HEX_PIECE_NOT_FOUND'
  // `moveHexPiece` targeted the hex the named piece already sits on (mirrors ROBBER_SAME_HEX).
  | 'HEX_PIECE_SAME_HEX'
  // ---- Traders & Barbarians — Fishermen (T-1002, docs/rules/traders-barbarians-rules.md §TB2) ----
  // `exchangeFish` named a benefit whose fixed fish cost (§TB2.4) the seat cannot currently afford.
  | 'NOT_ENOUGH_FISH'
  // `passOldBoot` from a seat that isn't the Old Boot's current holder (§TB2.5).
  | 'OLD_BOOT_NOT_HELD'
  // `passOldBoot` named a target the holder is NOT trailing or tied with (§TB2.5 — the boot may not
  // be dumped onto a strictly weaker opponent).
  | 'BAD_OLD_BOOT_TARGET'
  // ---- Traders & Barbarians — Rivers (T-1003, docs/rules/traders-barbarians-rules.md §TB3) ------
  // `buildRoad` named a river edge (a bridge is required there instead) OR `buildBridge` named a
  // non-river edge (§TB3.2) — one code covers both directions of the same mismatch.
  | 'NOT_A_RIVER_EDGE'
  // `tradeCoins` from a seat that doesn't hold the coins the current rate requires (§TB3.3).
  | 'NOT_ENOUGH_COINS'
  // ---- Traders & Barbarians — Barbarian Attack (T-1005, docs/rules/traders-barbarians-rules.md
  // §TB5) --------------------------------------------------------------------------------------
  // `moveBarbarianKnight` named a `to` edge farther than the resolved range (`KNIGHT_MOVE_RANGE`,
  // or `KNIGHT_MOVE_EXTENDED_RANGE` when `extended` is set) from `from` (§TB5.2). Reuses
  // `KNIGHT_NOT_FOUND`/`KNIGHT_INACTIVE` from Cities & Knights (T-803) for the other move failure
  // modes — same meaning, no reason to duplicate the code.
  | 'KNIGHT_MOVE_TOO_FAR'
  // `moveBarbarianKnight{extended:true}` when the once-per-turn extension is already spent this
  // turn-owner rotation (§TB5.2 `knightMovedThisTurn`).
  | 'KNIGHT_MOVE_EXTEND_UNAVAILABLE'
  // ---- Traders & Barbarians — the main scenario (T-1006, docs/rules/traders-barbarians-rules.md
  // §TB6) ------------------------------------------------------------------------------------
  // `moveWagon` named a `wagon` index that isn't one of the acting seat's own wagons.
  | 'WAGON_NOT_FOUND'
  // `moveWagon`'s `path` doesn't form a connected walk from the wagon's current vertex, or names an
  // unknown edge.
  | 'WAGON_MOVE_INVALID'
  // `moveWagon`'s `path` costs more movement points than `WAGON_MP_PER_TURN` (§TB6.2).
  | 'WAGON_MP_EXCEEDED'
  // `buildRoad` named an edge a `pathBarbarians` piece currently occupies (§TB6.3 — clear it first).
  | 'PATH_BARBARIAN_BLOCKED'
  // ---- Explorers & Pirates — ship movement + crew/cargo (T-1102, docs/rules/
  // explorers-pirates-rules.md §EP3) ---------------------------------------------------------
  // `moveEPShip`/`loadCargo`/`unloadCargo` named an edge that isn't one of the acting seat's own
  // ships (EP3.1: a ship's edge is its identity — one ship per edge).
  | 'SHIP_NOT_FOUND'
  // `buildEPShip`/`moveEPShip` named an edge that doesn't border a sea hex (EP3.1/EP3.2).
  | 'NOT_A_SEA_EDGE'
  // `moveEPShip` named a ship that was built THIS turn (⚠ VERIFY — see the `shipsBuiltThisTurn`
  // field's header comment in types.ts).
  | 'SHIP_BUILT_THIS_TURN'
  // `moveEPShip` named a ship that has already moved this turn-owner rotation (EP3.2, ≤1/turn).
  | 'SHIP_ALREADY_MOVED'
  // `moveEPShip`'s `to` edge is farther than `SHIP_MOVE_RANGE` sea-route hops from `from` (EP3.2).
  | 'SHIP_MOVE_TOO_FAR'
  // `loadCargo` named a ship whose cargo bay already holds `SHIP_CARGO_CAP` (2) pieces (EP3.3).
  | 'CARGO_FULL'
  // `unloadCargo` named a `piece` the ship's cargo bay does not currently carry (EP3.3).
  | 'CARGO_NOT_FOUND'
  // ---- Explorers & Pirates — settlers, founding & harbor settlements (T-1104, docs/rules/
  // explorers-pirates-rules.md §EP4) ---------------------------------------------------------
  // `foundSettlement` named a vertex touching no discovered (non-fog, non-`'gold'`) land hex (EP4.1).
  | 'NOT_DISCOVERED_LAND'
  // `foundSettlement` found no ship of the acting seat's carrying a `'settler'` cargo unit adjacent
  // to the target vertex (EP4.1).
  | 'SETTLER_NOT_FOUND'
  // ---- Explorers & Pirates — crews & the Pirate Lairs mission (T-1105, docs/rules/
  // explorers-pirates-rules.md §EP7) -----------------------------------------------------------
  // `placeCrewOnLair` named a hex with no active (uncaptured) pirate lair (EP7.2).
  | 'LAIR_NOT_FOUND'
  // `placeCrewOnLair` found no ship of the acting seat carrying a `'crew'` cargo unit adjacent to
  // the target hex (EP7.2, mirrors `SETTLER_NOT_FOUND`).
  | 'CREW_NOT_FOUND'
  // ---- Explorers & Pirates — fish/spice missions & the gold economy (T-1106, docs/rules/
  // explorers-pirates-rules.md §EP6/§EP8/§EP9) -------------------------------------------------
  // `shipGold`/`tradeSpice` from a seat whose gold total is below the action's fixed gold cost.
  | 'NOT_ENOUGH_GOLD'
  // `tradeSpice` named a hex with no active village (EP9).
  | 'VILLAGE_NOT_FOUND'
  // `deliverFish` found no ship of the acting seat carrying a `'fish'` cargo unit adjacent to
  // `councilVertex` (EP8, mirrors `SETTLER_NOT_FOUND`/`CREW_NOT_FOUND`).
  | 'FISH_NOT_FOUND'
  // `deliverSpice` found no ship of the acting seat carrying a `'spice'` cargo unit adjacent to
  // `councilVertex` (EP9, mirrors `FISH_NOT_FOUND`).
  | 'SPICE_NOT_FOUND';

// GameEvent (docs/03 §5)
export type GameEvent =
  | {
      type: 'gameStarted';
      config: GameConfig;
      board: {
        hexes: HexTile[];
        robber: HexId;
        harbors: Record<EdgeId, HarborType>;
      };
    }
  | { type: 'setupPlaced'; seat: Seat; piece: 'settlement' | 'road'; location: VertexId | EdgeId }
  | { type: 'startingResources'; seat: Seat; gained: ResourceBundle }
  | { type: 'diceRolled'; seat: Seat; roll: [number, number] }
  | { type: 'production'; gains: { seat: Seat; resources: ResourceBundle }[]; shortages: ResourceType[] }
  | { type: 'discardRequired'; seats: { seat: Seat; amount: number }[] }
  | { type: 'discarded'; seat: Seat; cards: ResourceBundle }
  | { type: 'robberMoved'; seat: Seat; hex: HexId }
  | { type: 'stolen'; from: Seat; to: Seat; card: ResourceType }
  | { type: 'built'; seat: Seat; piece: 'road' | 'settlement' | 'city'; location: VertexId | EdgeId }
  // Seafarers ships (S4/S7, T-702) — data only, the client translates. `shipMoved` carries both ends.
  | { type: 'shipBuilt'; seat: Seat; edge: EdgeId }
  | { type: 'shipMoved'; seat: Seat; from: EdgeId; to: EdgeId }
  // Seafarers pirate / gold / island chits (S8/S9/S10.6, T-703) — data only, the client translates.
  | { type: 'pirateMoved'; seat: Seat; hex: HexId }
  | { type: 'goldChosen'; seat: Seat; picks: ResourceBundle }
  | { type: 'islandSettled'; seat: Seat; island: number; vp: number }
  | { type: 'devBought'; seat: Seat; card: AnyDevCardId }
  // `card` also admits a cardMods combo id (T-904): combos are logged via `devPlayed` too, but
  // never sit in a hand/deck slot, so they widen only this one event field, not `AnyDevCardId`.
  | { type: 'devPlayed'; seat: Seat; card: AnyDevCardId | CardModComboId; detail?: unknown }
  | { type: 'monopolyResolved'; seat: Seat; resource: ResourceType; taken: { seat: Seat; count: number }[] }
  | { type: 'bankTraded'; seat: Seat; gave: ResourceBundle; got: ResourceBundle; rate: 2 | 3 | 4 }
  | { type: 'tradeOffered'; from: Seat; give: ResourceBundle; receive: ResourceBundle }
  | { type: 'tradeResponded'; responder: Seat; response: 'accepted' | 'declined' }
  | { type: 'tradeCompleted'; from: Seat; with: Seat; give: ResourceBundle; receive: ResourceBundle }
  | { type: 'tradeCancelled' }
  // T-906: `'harbormaster'` extends the existing award-transfer shape (docs/07 D-034) rather than
  // introducing a whole new event type — same {holder, value} payload, one more `award` tag.
  | { type: 'awardMoved'; award: 'longestRoad' | 'largestArmy' | 'harbormaster'; holder: Seat | null; value: number }
  | { type: 'turnEnded'; seat: Seat; next: Seat }
  // 5–6 extension extra-build events (X12) — emitted only by the fiveSix module.
  | { type: 'specialBuildStarted'; builder: Seat; queue: Seat[] }
  | { type: 'specialBuildPassed'; seat: Seat }
  | { type: 'pairedBuildStarted'; builder: Seat }
  | { type: 'pairedBuildEnded'; seat: Seat }
  // ---- Cities & Knights (T-802, docs/rules/cities-knights-rules.md) — data only, the client
  // translates. Emitted only by the citiesKnights module (never in a base/fiveSix/seafarers game).
  // C3.3: a producing roll's commodity gains (cities on forest/pasture/mountains), alongside the
  // (corrected) base `production` event for the same roll.
  | {
      type: 'commodityProduction';
      gains: { seat: Seat; commodities: Partial<Record<Commodity, number>> }[];
      shortages: Commodity[];
    }
  // C4.5 Science-L3 Aqueduct: a seat that produced nothing this roll takes 1 free resource.
  | { type: 'aqueductGranted'; seat: Seat; resource: ResourceType }
  // C4.1/C4.2: an improvement track advanced one level.
  | { type: 'improvementBuilt'; seat: Seat; track: ImprovementTrack; level: number }
  // C4.6: the first player to reach level 4 in a track places that track's metropolis.
  | { type: 'metropolisPlaced'; seat: Seat; track: ImprovementTrack }
  // C4.6: a level-5 player captures a metropolis from a player still at level 4.
  | { type: 'metropolisCaptured'; from: Seat; to: Seat; track: ImprovementTrack }
  // C4.5 Trade-L3 Trading House (or the uneven base 4:1): a commodity traded to the bank.
  | {
      type: 'commodityTraded';
      seat: Seat;
      give: Commodity;
      giveAmount: number;
      receive: ResourceType | Commodity;
      rate: 2 | 4;
    }
  // ---- Cities & Knights knights/barbarians (T-803, docs/rules/cities-knights-rules.md C5/C7/C8)
  // -- data only, the client translates. Emitted only by the citiesKnights module. --------------
  // C5.1/C5.2: the event die's result for this roll (rolled regardless of the number-die total).
  | { type: 'eventDieRolled'; seat: Seat; face: EventDieFace }
  // C8.1: a ship face advanced the barbarian track without triggering an attack yet.
  | { type: 'barbarianAdvanced'; position: number }
  // C6.2: a colour-gate face — `redDie` is the red number die this roll, for T-804's progress draw.
  | { type: 'progressGateOpened'; track: ImprovementTrack; redDie: number }
  // C8.2-C8.7: a barbarian attack resolved. `pillaged` lists each city downgraded to a settlement
  // (its wall destroyed); `tiedSeats` is non-empty only when `result` is 'defended' with no single
  // highest defender (C8.5).
  | {
      type: 'barbarianAttackResolved';
      attackStrength: number;
      defenseStrength: number;
      result: 'defended' | 'defeated';
      defenderSeat: Seat | null;
      tiedSeats: Seat[];
      pillaged: { seat: Seat; vertex: VertexId }[];
    }
  // C7.1/C7.2: a knight board-piece action.
  | { type: 'knightBuilt'; seat: Seat; vertex: VertexId; level: KnightLevel }
  | { type: 'knightActivated'; seat: Seat; vertex: VertexId }
  | { type: 'knightPromoted'; seat: Seat; vertex: VertexId; level: KnightLevel }
  | { type: 'knightMoved'; seat: Seat; from: VertexId; to: VertexId }
  | {
      type: 'knightDisplaced';
      seat: Seat;
      from: VertexId;
      to: VertexId;
      displacedSeat: Seat;
      displacedTo: VertexId | null;
    }
  // ---- Cities & Knights progress cards (T-804, C6) — data only, the client translates. Emitted
  // only by the citiesKnights module. -------------------------------------------------------------
  // C6.2: a progress card drawn on a colour-gate roll. `card` is redacted to non-owner viewers
  // (like `devBought`) — see redact.ts's `redactEvent`.
  | { type: 'progressCardDrawn'; seat: Seat; track: ImprovementTrack; card: ProgressCardId }
  // C6.3/C1.3: Printer/Constitution are revealed immediately on draw (never enter a hand) — public.
  | { type: 'progressCardRevealed'; seat: Seat; card: 'printer' | 'constitution' }
  // C6.3: hand-limit (4) auto-discard back to the bottom of the card's own deck (documented v1
  // simplification — see progressCards.ts). Redacted to non-owner viewers like `devBought`.
  | { type: 'progressCardDiscarded'; seat: Seat; card: ProgressCardId }
  // C6.4: a progress card played (publicly known which card, unlike drawing it). `detail` mirrors
  // `devPlayed`'s free-form per-card payload.
  | { type: 'progressCardPlayed'; seat: Seat; card: ProgressCardId; detail?: unknown }
  // Master Merchant / Wedding / Commercial Harbor (C6.5): cards moved from one seat to another.
  // Redacted like `stolen` — contents hidden from anyone but `from`/`to`.
  | {
      type: 'progressCardsTransferred';
      from: Seat;
      to: Seat;
      resources: ResourceBundle;
      commodities: Partial<Record<Commodity, number>>;
    }
  // Spy (C6.5): one progress card taken from another seat's hand. Redacted like `stolen`.
  | { type: 'progressCardTaken'; from: Seat; to: Seat; card: ProgressCardId }
  // Merchant (C6.5): the merchant piece placed/relocated onto a hex (public — it sits on the board).
  | { type: 'merchantPlaced'; seat: Seat; hex: HexId }
  // Engineer / a direct `buildCityWall` (C9.1/C6.5): public, the wall sits on the board.
  | { type: 'cityWallBuilt'; seat: Seat; vertex: VertexId }
  // Deserter (C6.5): an opponent's knight removed (paired with a `knightBuilt` for the replacement).
  | { type: 'knightRemoved'; seat: Seat; vertex: VertexId }
  // Diplomat (C6.5): an open road removed; `rebuilt` is true when the owner was the acting seat
  // (rebuilt free in the same instant, C6.5).
  | { type: 'roadRemoved'; seat: Seat; edge: EdgeId; rebuilt: boolean }
  // Inventor (C6.5): two hexes' number tokens swapped (public — tokens sit on the board).
  | { type: 'numberTokensSwapped'; hexA: HexId; hexB: HexId }
  // Commodity Monopoly (C6.5): the commodity analogue of `monopolyResolved`.
  | { type: 'commodityMonopolyResolved'; seat: Seat; commodity: Commodity; taken: { seat: Seat; count: number }[] }
  // ---- "The Helpers of Hexhaven" modifier (T-905) — data only, the client translates. Emitted only
  // when the `helpers` modifier is enabled. `helperUsed.detail` is redacted per-viewer for
  // Merchant/Mendicant/Priest/Architect (redact.ts's `redactEvent`, mirrors `stolen`/
  // `progressCardDrawn`) since it can reveal hand contents.
  | { type: 'helperDealt'; seat: Seat; helper: HelperId }
  | { type: 'helperUsed'; seat: Seat; helper: HelperId; side: 'A' | 'B'; detail?: unknown }
  | { type: 'helperSwapped'; seat: Seat; gave: HelperId | null; took: HelperId }
  // Event Cards modifier (T-904b, docs/tasks/modifiers-cards-RESEARCH.md D3a) — data only, the
  // client translates. Emitted only when the `eventCards` modifier is enabled, ALONGSIDE the usual
  // `diceRolled` (whose synthetic `roll` pair sums to `total`, so every existing dice-roll consumer
  // keeps working unchanged) — this event is the one the client keys off of to show the drawn card
  // instead of two dice faces.
  | { type: 'eventCardDrawn'; seat: Seat; total: number }
  // ---- Multi-piece hex framework (T-902, docs/07 D-034) — data only, the client translates.
  // Emitted only when the `hexPieces` modifier is enabled. ------------------------------------
  // Move-any: `piece` moved to `hex` instead of the base robber this 7/Knight (public — like
  // `robberMoved`, a hex piece's position is never hidden).
  | { type: 'hexPieceMoved'; seat: Seat; piece: HexPieceKindId; hex: HexId }
  // The Wizard's production hook (docs/tasks/modifiers-RESEARCH.md "Wizard"): `piece`'s hex paid
  // out an EXTRA `resource` to each listed owner (on top of whatever base production that hex
  // already resolved this same roll, R5 untouched).
  | {
      type: 'hexPieceProduction';
      piece: HexPieceKindId;
      hex: HexId;
      resource: ResourceType;
      gains: { seat: Seat; amount: number }[];
    }
  | { type: 'gameWon'; seat: Seat; vpBreakdown: unknown }
  // ---- Traders & Barbarians — Fishermen (T-1002, docs/rules/traders-barbarians-rules.md §TB2) —
  // data only, the client translates. Emitted only by the tradersBarbarians module in a fishermen
  // game. ------------------------------------------------------------------------------------------
  // §TB2.2: a producing roll's fish gains (Lake + fishing grounds), alongside the base `production`
  // event (empty/absent for a pure-water roll like 2/3/11/12 with no land hex sharing that token).
  | { type: 'fishProduced'; gains: { seat: Seat; amount: number }[] }
  // §TB2.5: a drawn Old Boot token was awarded to the sole current VP leader (no-op — ext unchanged —
  // when the leader tie leaves it unclaimed, so this event only fires on an actual holder change).
  | { type: 'oldBootAwarded'; seat: Seat }
  // §TB2.5: the holder passed the Old Boot to a trailing-or-tied opponent.
  | { type: 'oldBootPassed'; from: Seat; to: Seat }
  // §TB2.4: a fish exchange resolved. `detail` carries the benefit-specific target (the stolen-from
  // seat, the bank resource taken, or the free-road edge) for the client to render, mirroring
  // `devPlayed`'s free-form per-card payload.
  | { type: 'fishExchanged'; seat: Seat; benefit: FishBenefit; cost: number; detail?: unknown }
  // ---- Traders & Barbarians — Rivers (T-1003, docs/rules/traders-barbarians-rules.md §TB3) — data
  // only, the client translates. Emitted only by the tradersBarbarians module in a rivers game. -----
  // §TB3.2: a bridge built across a river edge (public — it sits on the board, like a road).
  | { type: 'bridgeBuilt'; seat: Seat; edge: EdgeId }
  // §TB3.1/§TB3.2: coins earned for building along the river shore (a settlement/road touching a
  // river-shore vertex/edge) or for building a bridge — `source` tells the client which rule fired.
  | { type: 'coinsAwarded'; seat: Seat; amount: number; source: 'shore' | 'bridge' }
  // §TB3.3: a coin-for-resource bank trade at the current rate (2:1 for the first two trades this
  // turn-owner rotation, 4:1 thereafter).
  | { type: 'coinsTraded'; seat: Seat; gave: number; received: ResourceType; rate: 2 | 4 }
  // ---- Traders & Barbarians — Caravans (T-1004, docs/rules/traders-barbarians-rules.md §TB4) — data
  // only, the client translates. Emitted only by the tradersBarbarians module in a caravans game. ----
  // §TB4.2: the camel-placement vote opened after `builder`'s settlement/city build; `pending` is the
  // full seat list owing a bid, builder first.
  | { type: 'caravanVoteOpened'; builder: Seat; pending: Seat[] }
  // §TB4.2: one seat's bid resolved (paid to the bank immediately, win or lose).
  | { type: 'caravanVoteCast'; seat: Seat; bid: number }
  // §TB4.2: every seat has bid — `winner` is the seat who may place a camel, or `null` when every
  // seat abstained (no camel placed this vote).
  | { type: 'caravanVoteResolved'; winner: Seat | null }
  // §TB4.2/§TB4.3: the vote's winner placed a camel on a caravan-route edge (public — sits on the
  // board, like a road).
  | { type: 'camelPlaced'; seat: Seat; edge: EdgeId }
  // ---- Traders & Barbarians — Barbarian Attack (T-1005, docs/rules/traders-barbarians-rules.md
  // §TB5) — data only, the client translates. Emitted only by the tradersBarbarians module in a
  // barbarianAttack game. Distinct NAMES from Cities & Knights' own knightBuilt/knightMoved/
  // barbarianAdvanced/etc. (C7/C8) — a separate, non-C&K system (§TB5.1). ------------------------
  | { type: 'tbKnightRecruited'; seat: Seat; edge: EdgeId }
  | { type: 'tbKnightMoved'; seat: Seat; from: EdgeId; to: EdgeId; extended: boolean }
  // §TB5.2: every barbarian that had a further hex to advance to stepped one hex toward the board
  // center this roll (barbarians already at the center hex are omitted — nothing to report).
  | { type: 'tbBarbariansAdvanced'; moves: { from: HexId; to: HexId }[] }
  // §TB5.2: active knights adjacent to `hex` outnumbered the barbarians there — driven off.
  // `rewards` lists each participating knight's owner: `captured` (a barbarian was actually
  // captured, `capturedBarbarians++`) or, once fewer barbarians remained than participating
  // knights, `gold` compensation instead (`BARBARIAN_GOLD`) for the rest.
  | {
      type: 'tbBarbarianCombatResolved';
      hex: HexId;
      barbariansDefeated: number;
      rewards: { seat: Seat; captured: boolean; gold: number }[];
    }
  // §TB5.2: barbarians were NOT outnumbered at `hex` and a settlement/city there was pillaged
  // (`downgraded` says which — a city drops to a settlement, a settlement is removed outright,
  // mirroring Cities & Knights' own C8.6 downgrade bookkeeping). `knightsLost` lists any knights
  // present that failed to stop it — each one is destroyed outright, owner compensated
  // `KNIGHT_LOSS_GOLD` gold.
  | {
      type: 'tbBarbarianPillaged';
      hex: HexId;
      seat: Seat;
      vertex: VertexId;
      downgraded: 'city' | 'settlement';
      knightsLost: { seat: Seat; edge: EdgeId; gold: number }[];
    }
  // §TB5.2: a barbarian reached the board's center hex with no settlement/city left to pillage
  // there and simply dispersed (removed, no reward/penalty to anyone) — the v1 termination rule
  // for a barbarian that survived its whole march.
  | { type: 'tbBarbarianDispersed'; hex: HexId }
  // ---- Traders & Barbarians — the main scenario (T-1006, docs/rules/traders-barbarians-rules.md
  // §TB6) — data only, the client translates. Emitted only by the tradersBarbarians module in a
  // tradersBarbarians-scenario game. -------------------------------------------------------------
  // §TB6.2: a new wagon placed at `vertex` (the city that just triggered it).
  | { type: 'tbWagonPlaced'; seat: Seat; vertex: VertexId }
  // §TB6.2: wagon `wagon` (its `ext.tradersBarbarians.wagons` index) moved along `path`, spending
  // `mpSpent` movement points; `loaded` names the commodity it auto-loaded at departure, if any.
  | { type: 'tbWagonMoved'; seat: Seat; wagon: number; path: EdgeId[]; mpSpent: number; loaded?: TBCommodity }
  // §TB6.1: a trade hex's number rolled — `gains` lists each adjacent builder's commodity haul.
  | { type: 'tbCommodityProduced'; hex: HexId; gains: { seat: Seat; commodities: Partial<Record<TBCommodity, number>> }[] }
  // §TB6.3: a wagon delivered `kind`'s needed commodity to its trade hex — `gained` lists the output
  // commodities credited to the seat's stock, alongside the flat `gold` reward.
  | {
      type: 'tbDeliveryCompleted';
      seat: Seat;
      hex: HexId;
      kind: 'quarry' | 'glassworks' | 'castle';
      gained: TBCommodity[];
      gold: number;
    }
  // ---- Explorers & Pirates — ship movement + crew/cargo (T-1102, docs/rules/
  // explorers-pirates-rules.md §EP3) — data only, the client translates. Emitted only by the
  // explorersPirates module in a live E&P game. Ships/cargo are fully public (EP3, board pieces
  // like a road). ---------------------------------------------------------------------------------
  | { type: 'epShipBuilt'; seat: Seat; edge: EdgeId }
  | { type: 'epShipMoved'; seat: Seat; from: EdgeId; to: EdgeId }
  | { type: 'epCargoLoaded'; seat: Seat; ship: EdgeId; piece: EPCargo }
  | { type: 'epCargoUnloaded'; seat: Seat; ship: EdgeId; piece: EPCargo }
  // T-1103 (§EP5.1/§EP12.4): a ship's arrival revealed `hex` — `tile` is the drawn outcome, now
  // written into `board.hexes`/`ext.explorersPirates.seaMap`. PUBLIC once revealed (EP5.1: "become
  // known to ALL players") — the hidden part was only ever the SUPPLY/unexplored fog, never this
  // event once emitted.
  | { type: 'epTileRevealed'; seat: Seat; hex: HexId; tile: EPTile }
  // ---- Explorers & Pirates — settlers, founding & harbor settlements (T-1104, docs/rules/
  // explorers-pirates-rules.md §EP4) — data only, the client translates. Emitted only by the
  // explorersPirates module in a live E&P game. Fully public (board pieces / an open tally, like
  // `built`/`epShipBuilt`). ------------------------------------------------------------------------
  | { type: 'epSettlerBuilt'; seat: Seat }
  | { type: 'epSettlementFounded'; seat: Seat; vertex: VertexId }
  | { type: 'epHarborSettlementBuilt'; seat: Seat; vertex: VertexId }
  // ---- Explorers & Pirates — crews & the Pirate Lairs mission (T-1105, docs/rules/
  // explorers-pirates-rules.md §EP7) — data only, the client translates. Emitted only by the
  // explorersPirates module in a live E&P game. Fully public (board pieces / an open tally, like
  // `epSettlerBuilt`/`epHarborSettlementBuilt`). ----------------------------------------------------
  | { type: 'epCrewBuilt'; seat: Seat }
  | { type: 'epCrewPlacedOnLair'; seat: Seat; hex: HexId }
  // T-1105 (§EP7.2): `hex`'s lair reached `LAIR_CAPTURE_CREWS` (3) crews and was captured — `awards`
  // lists each contributing seat's lair-capture VP (the v1 1-per-crew split, `modules/
  // explorersPirates/pirateLairs.ts`'s own header).
  | { type: 'epLairCaptured'; hex: HexId; awards: { seat: Seat; vp: number }[] }
  // ---- Explorers & Pirates — fish/spice missions & the gold economy (T-1106, docs/rules/
  // explorers-pirates-rules.md §EP6/§EP8/§EP9) — data only, the client translates. Emitted only by
  // the explorersPirates module in a live E&P game. Fully public (open tallies / board features,
  // like `epCrewBuilt`/`epLairCaptured`). ------------------------------------------------------
  // EP6.1: every listed seat received no resources on this producing roll and gained
  // `GOLD_COMPENSATION` gold each (`goldFishSpice.ts`'s `applyGoldCompensation`, a `rollDice`
  // `phaseHooks.afterAction` hook, E&P-gated).
  | { type: 'epGoldCompensated'; gains: { seat: Seat; amount: number }[] }
  // EP6.2: `seat` spent `GOLD_PER_VP` gold for 1 VP (`goldPoints[seat] += 1`).
  | { type: 'epGoldShipped'; seat: Seat }
  // EP8: `seat`'s ship arriving at `hex` (a fish shoal) auto-hauled a `'fish'` cargo unit.
  | { type: 'epFishHauled'; seat: Seat; hex: HexId }
  // EP8: `seat` delivered a `'fish'` cargo unit to the council for `vp` VP.
  | { type: 'epFishDelivered'; seat: Seat; vp: number }
  // EP9: `seat`'s ship at `hex` (a village) traded gold for a `'spice'` cargo unit.
  | { type: 'epSpiceTraded'; seat: Seat; hex: HexId }
  // EP9: `seat` delivered a `'spice'` cargo unit to the council for `vp` VP, raising its
  // `spiceBenefit` level to `benefit`.
  | { type: 'epSpiceDelivered'; seat: Seat; vp: number; benefit: number };
