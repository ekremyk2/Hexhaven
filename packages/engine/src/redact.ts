// T-204: per-seat redaction (docs/02 §6, docs/03 §5 tail note). This is the cheat-proofing
// boundary — `redact`/`redactEvent` are the ONLY places hidden information may be stripped, and
// they must strip it, never merely obscure it (the fields below are OMITTED, not zeroed/masked).
//
// `PlayerView`/`ViewerEvent` live here (not `@hexhaven/shared`) because `@hexhaven/shared` may only
// import zod (docs/02 §3) — it cannot depend on engine types. The server (and hot-seat/tests)
// import both from the engine's public index.

import { bundleTotal } from '@hexhaven/shared';
import type {
  AnyDevCardId,
  Commodity,
  EdgeId,
  EPCargo,
  GameConfig,
  GameEvent,
  GameState,
  HelperAssignment,
  HelperId,
  HexId,
  HexPieceInstance,
  ImprovementTrack,
  Knight,
  PlayerColor,
  PlayerState,
  ProgressCardId,
  ResourceType,
  ScenarioTerrain,
  Seat,
  TBCommodity,
  VertexId,
} from '@hexhaven/shared';

/** The viewer's own player: identical to the engine's `PlayerState` (full hand, dev cards, etc). */
export type OwnPlayerView = PlayerState;

/** Any OTHER player, as seen by a viewer: counts only where the real data is hidden (docs/02 §6). */
export interface OtherPlayerView {
  seat: Seat;
  color: PlayerColor;
  resourceCount: number;
  devCardCount: number;
  playedKnights: number;
  piecesLeft: { roads: number; settlements: number; cities: number };
  roads: PlayerState['roads'];
  settlements: PlayerState['settlements'];
  cities: PlayerState['cities'];
}

export type PlayerViewEntry = OwnPlayerView | OtherPlayerView;

/**
 * `redact(state, viewer)`'s output (docs/02 §6): everything public (board, bank, awards, phase,
 * turn, trade, stateVersion) rides through unchanged; `players` is per-seat — the viewer's own
 * entry is the full `PlayerState`, every other entry is an `OtherPlayerView`; `devDeck` collapses
 * to a count; `rng` is omitted entirely (never present, not even as `0` or `null`).
 */
export interface PlayerView {
  v: 1;
  me: Seat;
  config: GameConfig;
  board: GameState['board'];
  bank: GameState['bank'];
  devDeckCount: number;
  players: PlayerViewEntry[];
  turn: GameState['turn'];
  phase: GameState['phase'];
  awards: GameState['awards'];
  trade: GameState['trade'];
  /**
   * `hiddenSetupNumbers` modifier: true while the number tokens are being withheld (during setup).
   * The board's `hexes[*].token` are all stripped to `null` in that window, so the client can't read
   * them off the wire; this flag tells the client to render a "?" placeholder on every number-bearing
   * hex until reveal. Omitted (falsy) once setup completes / when the modifier is off.
   */
  hiddenNumbers?: boolean;
  /**
   * Expansion-owned state the CLIENT needs (T-603, docs/10 §3). Only the whitelisted, already-public
   * flags/seats are surfaced — never a module's hidden data. Today that is the 5–6 extension's
   * 2022 Paired-Players partial-turn marker (`ext.fiveSix.partialTurn`, which the client uses to
   * drive the restricted action bar). `builder`/`resumeFrom` are seat indices, not hidden info; the
   * 2015 SBP builder/queue already ride through `phase` (a `specialBuild` phase), so no extra field
   * is needed for it. Omitted entirely (`undefined`) in a base game, exactly like `state.ext`. */
  ext?: {
    fiveSix?: {
      partialTurn: { builder: Seat; resumeFrom: Seat } | null;
    };
    /** Seafarers public ship state (T-702): ships are fully public, exposed like roads. `hexTerrain`
     *  is the public sea/gold/land map the client needs to render the scenario board. Nothing here is
     *  hidden — the whole block rides through so the bot's determinized re-hydration (ai/determinize)
     *  sees the same per-turn ship bookkeeping the real engine enforces. */
    seafarers?: {
      ships: EdgeId[][];
      shipsLeft: number[];
      hexTerrain: ScenarioTerrain[];
      movedShipOnTurn: number;
      builtShips: { turn: number; edges: EdgeId[] };
      /** The pirate's sea hex (S8) and each seat's earned small-island chits (S10.6) — both public. */
      pirate: HexId;
      islandChits: number[][];
      /**
       * Fog Islands (T-756) PUBLIC fog state — present only for that scenario. `hidden` mirrors E&P's
       * `unexplored` (which hexes are still face-down is not secret, only their contents are — the
       * client renders a fog placeholder over `board.hexes`/`hexTerrain` at these indices). The
       * HIDDEN draw stack (`ext.seafarers.fog.stack`) is deliberately NOT a field here at all — the
       * actual cheat-proof omission (mirrors E&P's `explorationSupply` exclusion, EP12.4).
       */
      fog?: { hidden: HexId[] };
      /**
       * "Cloth for Hexhaven" (T-757) PUBLIC cloth counts — present only for that scenario, mirrors
       * `islandChits` above (cloth sits on the board, nothing hidden). Absent entirely for every other
       * seafarers scenario/game, exactly like `fog`.
       */
      cloth?: number[];
      /**
       * "The Pirate Islands" (T-758) PUBLIC auto-moving pirate track state + captured lairs —
       * present only for that scenario, mirrors `cloth`/`islandChits` above (the pirate's position/
       * safety and captured lairs all sit on the board, nothing hidden). Absent entirely for every
       * other seafarers scenario/game, exactly like `fog`/`cloth`.
       */
      pirateTrackIndex?: number;
      pirateTrackSafe?: boolean;
      lairs?: HexId[][];
      /**
       * "The Wonders of Hexhaven" (T-759) PUBLIC per-seat wonder-stage progress — present only for that
       * scenario, mirrors `cloth`/`lairs` above (wonder stages sit on the board, nothing hidden).
       * Absent entirely for every other seafarers scenario/game, exactly like `fog`/`cloth`/`lairs`.
       */
      wonder?: number[];
    };
    /**
     * Cities & Knights public state (T-804, docs/rules/cities-knights-rules.md C12). Everything here
     * is public EXCEPT progress-card hands and deck contents (C6.1/C6.3): `progressHandCounts` is
     * every seat's hand SIZE (public — an opponent's hand size is visible, like `devCardCount`);
     * `ownProgressHand` is the VIEWER's own actual cards only (looked up by `me`, so a viewer can
     * never receive another seat's cards here); `progressDeckCounts` collapses each of the 3 decks to
     * a remaining-card count, mirroring `devDeckCount` above. Knights/walls/improvements/commodities/
     * barbarian/metropolis/merchant/robberLocked/revealedProgress are all public board/track state
     * (C7-C10) and ride through unchanged.
     */
    citiesKnights?: {
      commodities: Record<Commodity, number>[];
      improvements: Record<ImprovementTrack, number>[];
      knights: Knight[][];
      walls: VertexId[][];
      progressHandCounts: number[];
      ownProgressHand: ProgressCardId[];
      defenderVp: number[];
      barbarian: { position: number; attacksResolved: number };
      metropolis: Record<ImprovementTrack, Seat | null>;
      progressDeckCounts: Record<ImprovementTrack, number>;
      merchant: { hex: HexId; owner: Seat } | null;
      robberLocked: boolean;
      revealedProgress: Partial<Record<'printer' | 'constitution', Seat>>;
      /** Alchemist's forced dice (C6.5): openly declared at the table when played ("you choose the
       *  values... this turn"), so — unlike a hand of cards — this is public, not hidden. */
      alchemistForced: [number, number] | null;
      /**
       * Spy peek reveal (redact.ts hidden-info UX fix): the VIEWER's own pending Spy peek of a
       * target's hand (`CitiesKnightsExt.spyPeek[viewer]`) — never another seat's, mirroring
       * `ownProgressHand` above. `null` while no peek is pending for this viewer.
       */
      spyPeek: { targetSeat: Seat; cards: ProgressCardId[] } | null;
    };
    /**
     * Multi-piece hex framework public state (T-902, docs/07 D-034): fully public, exactly like
     * `board.robber` one level up — every active piece's kind + current hex, so the client can
     * render it and offer the move-any picker.
     */
    hexPieces?: { pieces: HexPieceInstance[] };
    /**
     * "The Helpers of Hexhaven" modifier public state (T-905, docs/tasks/modifiers-helpers-RESEARCH.md
     * §3: "each player holds exactly one helper at a time" — the display and every seat's current
     * assignment are table-visible, like a face-up tile). Fully public: `usedThisTurn`/
     * `mayorEligible`/`captainRate` are each seat's own visible turn-state (an opponent's Captain
     * rate is a public bank-trade term, just like harbor rates), so this is a straight passthrough,
     * exactly like `hexPieces` above. Follow-up fix (Phase-9 play-UI task): this block was missing
     * entirely from `redactExt` even though `helperUsed`'s event redaction (below) already accounted
     * for it — `view.ext.helpers` was always `undefined`, so no client could have built the Helpers
     * HUD before this. `architectPeek` is the ONE genuinely hidden field in this otherwise-public
     * block (peek reveal fix, redact.ts hidden-info UX): unlike the passthrough fields above, it is
     * NOT `HelpersExt['architectPeek']` verbatim (a per-seat array) — only the VIEWER's own entry is
     * surfaced, as a single value, mirroring `citiesKnights.ownProgressHand`'s "my hand only"
     * discipline. `null` while no peek is pending for this viewer.
     */
    helpers?: {
      display: HelperId[];
      bySeat: (HelperAssignment | null)[];
      usedThisTurn: boolean[];
      mayorEligible: boolean[];
      captainRate: (ResourceType | null)[];
      architectPeek: AnyDevCardId[] | null;
    };
    /**
     * Harbormaster modifier public state (T-906, docs/07 D-034): the current holder + point tally,
     * fully public exactly like Longest Road / Largest Army in `awards` one level up. This block was
     * MISSING from `redactExt` — so `view.ext.harbormaster` was always `undefined` and the client had
     * no way to show the +2 award holder OR fold its +2 into the shown VP total. That desync let a
     * harbormaster holder reach the engine's authoritative `targetVp` (winning, R13.2) while the
     * scoreboard still displayed a total 2 short (user-reported "won at 13, target 15"). `null` holder
     * until first claimed. Present only when the modifier is active (`ext.harbormaster` set).
     */
    harbormaster?: { holder: Seat | null; points: number };
    /**
     * Fishermen scenario public state (T-1002, docs/rules/traders-barbarians-rules.md §TB2/§TB8.4).
     * `oldBoot`/`lakeHex`/`fishingGrounds`/`scenario` are public (the boot marker and the Lake/
     * fishing-ground layout sit on the table, like the robber). `fishStack` is deliberately NOT
     * surfaced here at all (§TB8.4: the draw pile is hidden — omitted entirely, not merely a count).
     * `fish` (§TB2.3) is normally a hidden per-seat hand redacted to a count, like `resourceCount`
     * above — but this v1 data model tracks only an AGGREGATE spendable total per seat (no separate
     * "how many face-down tokens" layer to redact to, docs/tasks/phase-10/T-1002-fishermen.md's
     * decided shape), so there is no lossy-but-safe "count" distinct from the real value to expose:
     * the total itself rides through for every seat, exactly as `resourceCount` would if a resource
     * hand had only one card type. Documented simplification — flagged for PM review alongside the
     * fishing-ground-position/fish-stack-multiset ⚠ VERIFY items.
     */
    tradersBarbarians?: {
      scenario: string;
      oldBoot: Seat | null;
      lakeHex?: HexId;
      fishingGrounds: { token: number; vertices: VertexId[] }[];
      fish: number[];
      /** Rivers (T-1003, §TB3.1/§TB8.4): per-seat coin totals — fully public (a tradeable, not a
       *  hidden hand). Present only in a rivers game. */
      coins?: number[];
      /** Rivers (§TB3.2): per-seat bridge edges — fully public (sits on the board). */
      bridges?: EdgeId[][];
      /** Rivers (§TB3.3): coin-bank trades made this turn-owner rotation (gates the 2:1->4:1 rate
       *  cliff) — fully public. */
      coinTradesThisTurn?: number;
      /**
       * Rivers (T-1051, 5–6, §TB3.1): THIS game's river edges/shore vertices/shore edges — fully
       * public (board geometry, like the robber/roads) and load-bearing for the client: `uiMode.ts`/
       * `tbActionLogic.ts` call `legalBridgeEdges(view, seat)` on this VIEW cast to `GameState` (see
       * this file's header note on that pattern), which reads `ext.tradersBarbarians.riverEdges` —
       * omitting these here would silently zero out every river/bridge highlight and the
       * `buildBridge` action-bar gate for every viewer (never the acting engine's own full state, so
       * a state-only test would never catch it).
       */
      riverEdges?: EdgeId[];
      riverShoreVertices?: VertexId[];
      riverShoreEdges?: EdgeId[];
      /** Caravans (T-1004, §TB4.1/§TB4.3): the Oasis hex, its caravan-route edges, and every placed
       *  camel — all fully public (sit on the board, like the robber/roads). */
      oasisHex?: HexId;
      routeEdges?: EdgeId[];
      camels?: EdgeId[];
      /** Barbarian Attack (T-1005, §TB5/§TB8.4): barbarians/knights/captured-count/gold are all
       *  fully public (board pieces + open coin/capture tallies, like the robber/roads) — every
       *  field rides through unredacted. */
      barbarians?: HexId[];
      /**
       * Barbarian Attack (T-1052, 5–6, §TB5.2): THIS game's center hex + next-hex march map — fully
       * public (board geometry, like the robber/roads) and load-bearing for the client the same way
       * rivers' `riverEdges`/etc. are (T-1051's fix this mirrors): `uiMode.ts`/`tbActionLogic.ts`
       * call `legalKnightRecruitEdges`/`legalKnightMoveTargets(view, seat, …)` on this VIEW cast to
       * `GameState`, and while those two specific helpers only read board edges (not this field),
       * omitting THIS field would still silently break any current/future client code that inspects
       * the barbarian march path (e.g. highlighting the center hex) — kept in lockstep with the
       * engine's own `ext.tradersBarbarians` shape on principle, like every other block here.
       */
      barbarianCenterHex?: HexId;
      barbarianNextHex?: Record<HexId, HexId>;
      knights?: { seat: Seat; edge: EdgeId; active: boolean }[];
      capturedBarbarians?: number[];
      gold?: number[];
      knightMovedThisTurn?: boolean;
      /** The main scenario (T-1006, §TB6/§TB8.4): commodity stock/wagons/trade-hex layout/path
       *  barbarians/delivery counts are all fully public (open tallies + board pieces, like the
       *  robber/roads) — every field rides through unredacted. */
      commodities?: Record<TBCommodity, number>[];
      wagons?: { seat: Seat; at: VertexId; cargo: TBCommodity | null }[];
      tradeHexes?: { hex: HexId; kind: 'quarry' | 'glassworks' | 'castle' }[];
      pathBarbarians?: EdgeId[];
      deliveries?: number[];
    };
    /**
     * Explorers & Pirates public state (T-1102/T-1103, docs/rules/explorers-pirates-rules.md
     * §EP3/§EP12.4). `ships`/`gold`/`shipsBuiltThisTurn`/`movedShipsThisTurn` are fully public, as
     * T-1102 left them (ships are board pieces, like roads; gold is an open per-seat tally; the
     * per-turn bookkeeping mirrors seafarers' `builtShips`/`movedShipOnTurn`).
     *
     * `seaMap`/`unexplored` are where T-1103's fog boundary lives: `unexplored` (which hexes are
     * still face-down) is ITSELF public — the client needs it to render fog placeholders — but
     * `seaMap`'s entries for those same hexes are fogged to `'sea'` here (never the real terrain/
     * gold classification), exactly like `board.hexes` is fogged one level up in `redact()`. This
     * is deliberately unconditional (always re-write those entries, never merely check-and-pass):
     * even if a future scenario pre-stores the real classification in `seaMap`/`board.hexes` ahead
     * of reveal (this v1 `seedExplorationV0` test model doesn't — see state.ts), the redaction still
     * can't leak it. The exploration-tile SUPPLY backing all of this (`ext.explorersPirates.
     * explorationSupply`, its order + remaining contents) is OMITTED entirely — no field for it
     * exists anywhere in this view — the actual cheat-proof boundary (EP12.4: omit, don't mask).
     */
    explorersPirates?: {
      scenario: string;
      seaMap: ScenarioTerrain[];
      ships: { seat: Seat; edge: EdgeId; cargo: EPCargo[] }[];
      shipsBuiltThisTurn: EdgeId[];
      movedShipsThisTurn: EdgeId[];
      gold: number[];
      /** T-1103 (§EP2.1/§EP5.1): hexes still face-down — PUBLIC (only their contents are hidden).
       *  The client renders a fog placeholder over `board.hexes`/`seaMap` at each of these indices. */
      unexplored: HexId[];
      /** T-1104 (§EP4.2): per-seat harbor settlements — fully public (pieces), like `ships`. */
      harborSettlements: VertexId[][];
      /** T-1104 (§EP4.1): per-seat un-loaded settler reserve — fully public (an open tally), like
       *  `gold`. */
      settlerSupply: number[];
      /** T-1105 (§EP7.1): per-seat un-loaded crew reserve — fully public (an open tally), mirrors
       *  `settlerSupply`. */
      crewSupply: number[];
      /** T-1105 (§EP7.2): active (uncaptured) pirate lairs — fully public (a board piece), like
       *  `harborSettlements`. */
      pirateLairs: { hex: HexId; crews: Seat[] }[];
      /** T-1105 (§EP7.2): per-seat lair-capture VP earned so far — fully public (an open tally),
       *  like `gold`/`settlerSupply`. */
      lairPoints: number[];
      /** T-1106 (§EP8): sea hexes holding a fish shoal — fully public (a board feature), like
       *  `pirateLairs`. */
      fishShoals: HexId[];
      /** T-1106 (§EP9): revealed-land hexes holding a village — fully public (a board feature). */
      villages: HexId[];
      /** T-1106 (§EP8/§EP9): the home-island council delivery vertex — fully public (a fixed board
       *  landmark), present once seeded. */
      councilVertex?: VertexId;
      /** T-1106 (§EP8): per-seat fish-delivery VP — fully public (an open tally), like `lairPoints`. */
      fishPoints: number[];
      /** T-1106 (§EP9): per-seat spice-delivery VP — fully public, like `fishPoints`. */
      spicePoints: number[];
      /** T-1106 (§EP6.2): per-seat VP from `shipGold` — fully public, like `gold`. */
      goldPoints: number[];
      /** T-1106 (§EP9): per-seat spice-benefit level (read by `moveEPShip`'s ship-range bonus) —
       *  fully public, like `gold`. */
      spiceBenefit: number[];
    };
  };
  stateVersion: number;
}

/** Whitelist `state.ext` down to only the public flags the client is allowed to see (T-603). Same
 * discipline as `redactOtherPlayer`: a fresh object is built from named fields, never a spread of
 * the module's own state — so a future module field can't silently leak through here. */
function redactExt(ext: GameState['ext'], viewer: Seat): PlayerView['ext'] {
  if (
    !ext?.fiveSix &&
    !ext?.seafarers &&
    !ext?.citiesKnights &&
    !ext?.hexPieces &&
    !ext?.helpers &&
    !ext?.harbormaster &&
    !ext?.tradersBarbarians &&
    !ext?.explorersPirates
  )
    return undefined;
  const out: NonNullable<PlayerView['ext']> = {};
  // partialTurn is `{ builder: Seat; resumeFrom: Seat } | null` — seats only, no hidden information.
  if (ext.fiveSix) out.fiveSix = { partialTurn: ext.fiveSix.partialTurn };
  // Ships are fully public (S1/S3): expose ships, remaining supply, and the sea/gold/land map. The
  // per-turn move/build bookkeeping is engine-internal and deliberately NOT surfaced. Fresh copies,
  // never a spread of the module's own state, so a future field can't silently leak through here.
  if (ext.seafarers) {
    // Fog Islands (T-756): unconditionally re-fog `hexTerrain` at every still-hidden index — mirrors
    // E&P's `seaMap` unconditional rewrite (defense in depth even if a future scenario pre-stores the
    // real classification there ahead of reveal; today's `seedScenarioFog`/`revealFogAt` never do).
    // An empty set (every non-Fog-Islands game) makes this a no-op copy, same as before this task.
    const fogHidden = new Set(ext.seafarers.fog?.hidden ?? []);
    out.seafarers = {
      ships: ext.seafarers.ships.map((list) => [...list]),
      shipsLeft: [...ext.seafarers.shipsLeft],
      hexTerrain: ext.seafarers.hexTerrain.map((t, hex) => (fogHidden.has(hex as HexId) ? 'sea' : t)),
      movedShipOnTurn: ext.seafarers.movedShipOnTurn,
      builtShips: { turn: ext.seafarers.builtShips.turn, edges: [...ext.seafarers.builtShips.edges] },
      // Pirate + island chits are public (on-board): fresh copies, never a spread of module state.
      pirate: ext.seafarers.pirate,
      islandChits: ext.seafarers.islandChits.map((list) => [...list]),
      // Fog Islands (T-756): ONLY `hidden` rides through (public — which hexes are fog is not
      // secret) — `stack` (the hidden draw pile) has NO field here at all, mirroring E&P's
      // `explorationSupply` omission. Absent entirely for every other seafarers scenario/game.
      ...(ext.seafarers.fog ? { fog: { hidden: [...ext.seafarers.fog.hidden] } } : {}),
      // Cloth for Hexhaven (T-757): a plain public passthrough, no masking needed (cloth counts sit on
      // the board, exactly like islandChits above) — absent entirely for every other scenario, so this
      // key never even appears there (same discipline as `fog`).
      ...(ext.seafarers.cloth ? { cloth: [...ext.seafarers.cloth] } : {}),
      // The Pirate Islands (T-758): plain public passthroughs, no masking needed (the pirate's
      // position/track-safety and captured lairs all sit on the board, exactly like `pirate`/
      // `islandChits` above) — absent entirely for every other scenario (same discipline as `cloth`).
      ...(ext.seafarers.pirateTrackIndex !== undefined
        ? { pirateTrackIndex: ext.seafarers.pirateTrackIndex }
        : {}),
      ...(ext.seafarers.pirateTrackSafe !== undefined ? { pirateTrackSafe: ext.seafarers.pirateTrackSafe } : {}),
      ...(ext.seafarers.lairs ? { lairs: ext.seafarers.lairs.map((list) => [...list]) } : {}),
      // Wonders of Hexhaven (T-759): a plain public passthrough, no masking needed (wonder stages sit on
      // the board, mirrors `cloth`/`lairs`). Absent entirely for every other scenario.
      ...(ext.seafarers.wonder ? { wonder: [...ext.seafarers.wonder] } : {}),
    };
  }
  // Cities & Knights (T-804, C12): only `progressHand`/`progressDecks` are hidden information —
  // everything else is public board/track state. Fresh copies throughout, never a spread of the
  // module's own state, so a future field can't silently leak through here.
  if (ext.citiesKnights) {
    const ck = ext.citiesKnights;
    out.citiesKnights = {
      commodities: ck.commodities.map((c) => ({ ...c })),
      improvements: ck.improvements.map((i) => ({ ...i })),
      knights: ck.knights.map((list) => list.map((k) => ({ ...k }))),
      walls: ck.walls.map((w) => [...w]),
      progressHandCounts: ck.progressHand.map((h) => h.length),
      ownProgressHand: [...(ck.progressHand[viewer] ?? [])],
      defenderVp: [...ck.defenderVp],
      barbarian: { ...ck.barbarian },
      metropolis: { ...ck.metropolis },
      progressDeckCounts: {
        trade: ck.progressDecks.trade.length,
        politics: ck.progressDecks.politics.length,
        science: ck.progressDecks.science.length,
      },
      merchant: ck.merchant ? { ...ck.merchant } : null,
      robberLocked: ck.robberLocked,
      revealedProgress: { ...ck.revealedProgress },
      alchemistForced: ck.alchemistForced,
      // Spy peek reveal (redact.ts hidden-info UX fix): ONLY `viewer`'s own pending peek, never
      // another seat's — mirrors `ownProgressHand` above exactly (looked up by `viewer`, fresh copy).
      spyPeek: ck.spyPeek[viewer] ? { targetSeat: ck.spyPeek[viewer]!.targetSeat, cards: [...ck.spyPeek[viewer]!.cards] } : null,
    };
  }
  // Multi-piece hex framework (T-902): fully public (like the robber) — a fresh copy, never a
  // spread of the module's own state, matching every other block above.
  if (ext.hexPieces) {
    out.hexPieces = { pieces: ext.hexPieces.pieces.map((p) => ({ ...p })) };
  }
  // Helpers (T-905): fully public (research §3) — a fresh copy, never a spread of the module's own
  // state, matching every other block above. `architectPeek` is the ONE exception (peek reveal fix,
  // redact.ts hidden-info UX): ONLY `viewer`'s own pending peek, never another seat's — mirrors
  // `citiesKnights.ownProgressHand`'s "my hand only" discipline above.
  if (ext.helpers) {
    out.helpers = {
      display: [...ext.helpers.display],
      bySeat: ext.helpers.bySeat.map((a) => (a ? { ...a } : null)),
      usedThisTurn: [...ext.helpers.usedThisTurn],
      mayorEligible: [...ext.helpers.mayorEligible],
      captainRate: [...ext.helpers.captainRate],
      architectPeek: ext.helpers.architectPeek[viewer] ? [...ext.helpers.architectPeek[viewer]!] : null,
    };
  }
  // Harbormaster (T-906): fully public (holder + tally), like Longest Road / Largest Army — a fresh
  // copy, never a spread of the module's own state, matching every other block above.
  if (ext.harbormaster) {
    out.harbormaster = { holder: ext.harbormaster.holder, points: ext.harbormaster.points };
  }
  // Fishermen (T-1002, §TB2/§TB8.4): `fishStack` is deliberately excluded — never even a count (the
  // draw pile is fully hidden). `fish` rides through for every seat (a documented simplification —
  // see the `PlayerView['ext']['tradersBarbarians']` field comment above for why). Fresh copies
  // throughout, never a spread of the module's own state, matching every other block above.
  if (ext.tradersBarbarians) {
    const tb = ext.tradersBarbarians;
    out.tradersBarbarians = {
      scenario: tb.scenario,
      oldBoot: tb.oldBoot ?? null,
      ...(tb.lakeHex !== undefined ? { lakeHex: tb.lakeHex } : {}),
      fishingGrounds: (tb.fishingGrounds ?? []).map((g) => ({ token: g.token, vertices: [...g.vertices] })),
      fish: [...(tb.fish ?? [])],
      // Rivers (T-1003, §TB3.1-§TB3.3): coins/bridges/coinTradesThisTurn are all fully public — ride
      // through as fresh copies, matching every other block above.
      ...(tb.coins ? { coins: [...tb.coins] } : {}),
      ...(tb.bridges ? { bridges: tb.bridges.map((list) => [...list]) } : {}),
      ...(tb.coinTradesThisTurn !== undefined ? { coinTradesThisTurn: tb.coinTradesThisTurn } : {}),
      // Rivers (T-1051, 5–6, §TB3.1): riverEdges/riverShoreVertices/riverShoreEdges are fully public
      // board geometry (like bridges above) — fresh copies, load-bearing for `legalBridgeEdges`
      // called on this view (see the field comment above).
      ...(tb.riverEdges ? { riverEdges: [...tb.riverEdges] } : {}),
      ...(tb.riverShoreVertices ? { riverShoreVertices: [...tb.riverShoreVertices] } : {}),
      ...(tb.riverShoreEdges ? { riverShoreEdges: [...tb.riverShoreEdges] } : {}),
      // Caravans (T-1004, §TB4.1/§TB4.3): oasisHex/routeEdges/camels are all fully public — ride
      // through as fresh copies, matching every other block above.
      ...(tb.oasisHex !== undefined ? { oasisHex: tb.oasisHex } : {}),
      ...(tb.routeEdges ? { routeEdges: [...tb.routeEdges] } : {}),
      ...(tb.camels ? { camels: [...tb.camels] } : {}),
      // Barbarian Attack (T-1005, §TB5/§TB8.4): barbarians/knights/capturedBarbarians/gold/
      // knightMovedThisTurn are all fully public — fresh copies, matching every other block above.
      ...(tb.barbarians ? { barbarians: [...tb.barbarians] } : {}),
      // Barbarian Attack (T-1052, 5–6, §TB5.2): center hex + next-hex march map — fully public
      // board geometry (like riverEdges above), fresh copies.
      ...(tb.barbarianCenterHex !== undefined ? { barbarianCenterHex: tb.barbarianCenterHex } : {}),
      ...(tb.barbarianNextHex ? { barbarianNextHex: { ...tb.barbarianNextHex } } : {}),
      ...(tb.knights ? { knights: tb.knights.map((k) => ({ ...k })) } : {}),
      ...(tb.capturedBarbarians ? { capturedBarbarians: [...tb.capturedBarbarians] } : {}),
      ...(tb.gold ? { gold: [...tb.gold] } : {}),
      ...(tb.knightMovedThisTurn !== undefined ? { knightMovedThisTurn: tb.knightMovedThisTurn } : {}),
      // The main scenario (T-1006, §TB6/§TB8.4): commodities/wagons/tradeHexes/pathBarbarians/
      // deliveries are all fully public — fresh copies, matching every other block above.
      ...(tb.commodities ? { commodities: tb.commodities.map((c) => ({ ...c })) } : {}),
      ...(tb.wagons ? { wagons: tb.wagons.map((w) => ({ ...w })) } : {}),
      ...(tb.tradeHexes ? { tradeHexes: tb.tradeHexes.map((t) => ({ ...t })) } : {}),
      ...(tb.pathBarbarians ? { pathBarbarians: [...tb.pathBarbarians] } : {}),
      ...(tb.deliveries ? { deliveries: [...tb.deliveries] } : {}),
    };
  }
  // Explorers & Pirates (T-1102/T-1103, §EP3/§EP5/§EP12.4): ships/gold/per-turn bookkeeping are all
  // fully public — fresh copies throughout, never a spread of the module's own state, matching every
  // other block above. `seaMap`/`unexplored` carry T-1103's fog boundary — see this file's
  // `PlayerView['ext']['explorersPirates']` field comment for why the fogging below is unconditional.
  // `explorationSupply` is NEVER read here — no field for it exists on `out.explorersPirates` at all,
  // which is the actual omission (EP12.4): there is no way for it to leak through this function.
  if (ext.explorersPirates) {
    const ep = ext.explorersPirates;
    const unexplored = [...(ep.unexplored ?? [])];
    const fog = new Set(unexplored);
    out.explorersPirates = {
      scenario: ep.scenario,
      seaMap: (ep.seaMap ?? []).map((t, hex) => (fog.has(hex as HexId) ? 'sea' : t)),
      ships: (ep.ships ?? []).map((s) => ({ seat: s.seat, edge: s.edge, cargo: [...s.cargo] })),
      shipsBuiltThisTurn: [...(ep.shipsBuiltThisTurn ?? [])],
      movedShipsThisTurn: [...(ep.movedShipsThisTurn ?? [])],
      gold: [...(ep.gold ?? [])],
      unexplored,
      // T-1104 (§EP4.1/§EP4.2): harbor settlements/settler reserve are fully public — fresh copies,
      // matching every other field above.
      harborSettlements: (ep.harborSettlements ?? []).map((list) => [...list]),
      settlerSupply: [...(ep.settlerSupply ?? [])],
      // T-1105 (§EP7): crew reserve/pirate lairs/lair-capture VP are all fully public — fresh
      // copies, matching every other field above.
      crewSupply: [...(ep.crewSupply ?? [])],
      pirateLairs: (ep.pirateLairs ?? []).map((l) => ({ hex: l.hex, crews: [...l.crews] })),
      lairPoints: [...(ep.lairPoints ?? [])],
      // T-1106 (§EP6/§EP8/§EP9): fish shoals/villages/council/fish-spice-gold VP/spice benefit are
      // all fully public — fresh copies, matching every other field above.
      fishShoals: [...(ep.fishShoals ?? [])],
      villages: [...(ep.villages ?? [])],
      ...(ep.councilVertex !== undefined ? { councilVertex: ep.councilVertex } : {}),
      fishPoints: [...(ep.fishPoints ?? [])],
      spicePoints: [...(ep.spicePoints ?? [])],
      goldPoints: [...(ep.goldPoints ?? [])],
      spiceBenefit: [...(ep.spiceBenefit ?? [])],
    };
  }
  return out;
}

function redactOtherPlayer(p: PlayerState): OtherPlayerView {
  return {
    seat: p.seat,
    color: p.color,
    resourceCount: bundleTotal(p.resources),
    devCardCount: p.devCards.length,
    playedKnights: p.playedKnights,
    piecesLeft: { ...p.piecesLeft },
    roads: [...p.roads],
    settlements: [...p.settlements],
    cities: [...p.cities],
  };
}

/**
 * Full board/bank/awards/phase/turn/trade/stateVersion + the viewer's own `PlayerState` complete;
 * every other player redacted to counts (docs/02 §6). `rng` and the dev-deck's contents/order are
 * never present anywhere in the result.
 */
export function redact(state: GameState, viewer: Seat): PlayerView {
  // `hiddenSetupNumbers` modifier: while the game is still in initial placement, strip every hex's
  // number token from the view (OMITTED, not masked — this is the cheat-proofing boundary) and flag
  // the view so the client renders "?" placeholders. Once setup completes the phase is no longer
  // `setup`, so the real tokens ride through unchanged. Gated on the modifier + phase, so the
  // default path returns `state.board` verbatim exactly as before (RK-13 / no extra allocation).
  const hideNumbers =
    state.config.modifiers?.hiddenSetupNumbers === true && state.phase.kind === 'setup';
  // Explorers & Pirates fog (T-1103, §EP2.1/§EP5/§EP12.4): every hex still in `unexplored` is
  // stripped to the same fog placeholder `board.ts`'s sea/gold proxy already uses elsewhere
  // (`{terrain:'desert',token:null}`) — OMITTED, not masked, exactly like `hiddenSetupNumbers` above.
  // Unconditional (always re-write, never check-and-pass): even if a future scenario pre-stores the
  // real terrain there ahead of reveal, this can't leak it (see `PlayerView`'s field comment). Empty
  // outside a live E&P game (`ext.explorersPirates` absent) or once every hex is revealed, so the
  // default path returns `state.board` verbatim exactly as before (RK-13 / no extra allocation).
  const epFogHexes = new Set(state.ext?.explorersPirates?.unexplored ?? []);
  // Fog Islands (T-756, S-analogue of the E&P fog above): every hex still in `ext.seafarers.fog.
  // hidden` is stripped to the SAME fog placeholder — OMITTED, not masked, and unconditional for the
  // same reason as `epFogHexes` (defense in depth even if a future scenario pre-stores the real
  // content there). Empty outside a Fog Islands game (`ext.seafarers.fog` absent) or once every fog
  // hex is revealed, so the default path returns `state.board` verbatim (RK-13 / no extra alloc) —
  // gated strictly to this one scenario, every other seafarers game/scenario is unaffected.
  const seafarersFogHexes = new Set(state.ext?.seafarers?.fog?.hidden ?? []);
  const board =
    hideNumbers || epFogHexes.size > 0 || seafarersFogHexes.size > 0
      ? {
          ...state.board,
          hexes: state.board.hexes.map((h, hex) => {
            if (epFogHexes.has(hex as HexId) || seafarersFogHexes.has(hex as HexId)) {
              return { terrain: 'desert' as const, token: null };
            }
            return hideNumbers && h.token !== null ? { ...h, token: null } : h;
          }),
        }
      : state.board;

  return {
    v: 1,
    me: viewer,
    config: state.config,
    board,
    bank: state.bank,
    devDeckCount: state.devDeck.length,
    players: state.players.map((p) => (p.seat === viewer ? { ...p } : redactOtherPlayer(p))),
    turn: state.turn,
    phase: state.phase,
    awards: state.awards,
    trade: state.trade,
    ...(hideNumbers ? { hiddenNumbers: true as const } : {}),
    ...(redactExt(state.ext, viewer) ? { ext: redactExt(state.ext, viewer) } : {}),
    stateVersion: state.stateVersion,
  };
}

// ---- Event redaction (docs/02 §6, docs/03 §5, ER-9/ER-10) -------------------------------------

/** `discarded`, redacted for a non-owner viewer: card identities collapse to a bare count (ER-9). */
export interface RedactedDiscarded {
  type: 'discarded';
  seat: Seat;
  count: number;
}

/** `stolen`, redacted for anyone but the thief/victim: the card type is omitted entirely (ER-10). */
export interface RedactedStolen {
  type: 'stolen';
  from: Seat;
  to: Seat;
}

/** `devBought`, redacted for a non-buyer viewer: which card was bought is omitted. */
export interface RedactedDevBought {
  type: 'devBought';
  seat: Seat;
}

/** `progressCardDrawn`/`progressCardDiscarded` (T-804, C6.2/C6.3), redacted for a non-owner
 *  viewer: the card identity is omitted, mirroring `devBought`. */
export interface RedactedProgressCardDrawn {
  type: 'progressCardDrawn';
  seat: Seat;
  track: ImprovementTrack;
}
export interface RedactedProgressCardDiscarded {
  type: 'progressCardDiscarded';
  seat: Seat;
}

/** `progressCardsTransferred`/`progressCardTaken` (T-804, C6.5), redacted for anyone but the two
 *  seats involved: contents/identity are omitted, mirroring `stolen`. */
export interface RedactedProgressCardsTransferred {
  type: 'progressCardsTransferred';
  from: Seat;
  to: Seat;
}
export interface RedactedProgressCardTaken {
  type: 'progressCardTaken';
  from: Seat;
  to: Seat;
}

/**
 * `helperUsed` (T-905, "The Helpers of Hexhaven" modifier), redacted for a non-actor viewer: `detail`
 * is omitted for the 4 helpers whose payload can reveal hand contents — Merchant (`giveBack`),
 * Mendicant/Priest (cost substitution), Architect (which dev card was picked from the peeked 3) —
 * mirroring `devBought`/`stolen`. The other 5 helpers' `detail` is already public (e.g. Explorer's
 * `from`/`to` are just board edges), so it rides through unchanged for everyone.
 */
export interface RedactedHelperUsed {
  type: 'helperUsed';
  seat: Seat;
  helper: HelperId;
  side: 'A' | 'B';
}

const HAND_REVEALING_HELPERS: ReadonlySet<HelperId> = new Set(['merchant', 'mendicant', 'priest', 'architect']);

/**
 * Every `GameEvent` as a viewer may receive it: the hidden-information variants are replaced by
 * their redacted shape for viewers not entitled to see the real data; every other event type
 * passes through `GameEvent` unchanged.
 */
export type ViewerEvent =
  | Exclude<
      GameEvent,
      | { type: 'discarded' }
      | { type: 'stolen' }
      | { type: 'devBought' }
      | { type: 'progressCardDrawn' }
      | { type: 'progressCardDiscarded' }
      | { type: 'progressCardsTransferred' }
      | { type: 'progressCardTaken' }
      | { type: 'helperUsed' }
    >
  | Extract<GameEvent, { type: 'discarded' }>
  | RedactedDiscarded
  | Extract<GameEvent, { type: 'stolen' }>
  | RedactedStolen
  | Extract<GameEvent, { type: 'devBought' }>
  | RedactedDevBought
  | Extract<GameEvent, { type: 'progressCardDrawn' }>
  | RedactedProgressCardDrawn
  | Extract<GameEvent, { type: 'progressCardDiscarded' }>
  | RedactedProgressCardDiscarded
  | Extract<GameEvent, { type: 'progressCardsTransferred' }>
  | RedactedProgressCardsTransferred
  | Extract<GameEvent, { type: 'progressCardTaken' }>
  | RedactedProgressCardTaken
  | Extract<GameEvent, { type: 'helperUsed' }>
  | RedactedHelperUsed;

/**
 * `redactEvent(ev, viewer)` (docs/02 §6): `discarded` → counts for everyone but the discarder
 * (ER-9); `stolen` → the card is omitted unless `viewer` is the thief or the victim (ER-10);
 * `devBought` → the card is omitted unless `viewer` is the buyer. Every other event is returned
 * as-is (already public by rule — dice, builds, monopoly/YoP resolution, bank/domestic trades, …).
 */
export function redactEvent(ev: GameEvent, viewer: Seat): ViewerEvent {
  switch (ev.type) {
    case 'discarded':
      if (ev.seat === viewer) return ev;
      return { type: 'discarded', seat: ev.seat, count: bundleTotal(ev.cards) };
    case 'stolen':
      if (viewer === ev.from || viewer === ev.to) return ev;
      return { type: 'stolen', from: ev.from, to: ev.to };
    case 'devBought':
      if (ev.seat === viewer) return ev;
      return { type: 'devBought', seat: ev.seat };
    // T-804 (C6.2/C6.3/C6.5): same discipline as devBought/stolen for progress cards.
    case 'progressCardDrawn':
      if (ev.seat === viewer) return ev;
      return { type: 'progressCardDrawn', seat: ev.seat, track: ev.track };
    case 'progressCardDiscarded':
      if (ev.seat === viewer) return ev;
      return { type: 'progressCardDiscarded', seat: ev.seat };
    case 'progressCardsTransferred':
      if (viewer === ev.from || viewer === ev.to) return ev;
      return { type: 'progressCardsTransferred', from: ev.from, to: ev.to };
    case 'progressCardTaken':
      if (viewer === ev.from || viewer === ev.to) return ev;
      return { type: 'progressCardTaken', from: ev.from, to: ev.to };
    // T-905: Merchant/Mendicant/Priest/Architect's `detail` can reveal hand contents — omit it for
    // anyone but the acting seat, same discipline as `devBought`/`stolen`. Every other helper's
    // `detail` is already public, so it rides through unchanged.
    case 'helperUsed':
      if (ev.seat === viewer || !HAND_REVEALING_HELPERS.has(ev.helper)) return ev;
      return { type: 'helperUsed', seat: ev.seat, helper: ev.helper, side: ev.side };
    default:
      return ev;
  }
}
