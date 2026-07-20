// createGame (docs/02 §4): deterministic initial GameState from a GameConfig.
// Order of business: validate config → resolve module-tunable constants → seed rng → board →
// dev deck shuffle → bank/players → setup phase, stateVersion 0.

import type {
  AnyDevCardId,
  CitiesKnightsExt,
  EPTile,
  GameConfig,
  GameState,
  HexId,
  PlayerState,
  ScenarioTerrain,
  Seat,
  VertexId,
} from '@hexhaven/shared';
import { generateBoard } from './boardGen.js';
import { initCitiesKnightsExt } from './modules/citiesKnights/index.js';
import {
  EP_EXPLORATION_TILES,
  EP_EXPLORATION_TILES_56,
  EP_SCENARIO_CONFIG,
  FISH_SHOAL_COUNT_56,
  LAND_HO_56_GEOMETRY,
  SHIPPED_EP_SCENARIOS,
  VILLAGE_COUNT_56,
  buildLandHoBoard56,
  buildLandHoBoardV0,
  explorersPiratesScenario,
  seedExplorationV0,
  seedFishSpiceV0,
} from './modules/explorersPirates/index.js';
import type { EPScenarioId } from './modules/explorersPirates/index.js';
import { geometryForConfig, resolveConstants, resolveModules } from './modules/index.js';
import {
  generateScenarioBoard,
  initialSeafarersExt,
  scenarioBoardFor,
  scenarioFor,
  scenarioPirateTrackFor,
  seedScenarioFog,
} from './modules/seafarers/index.js';
import type { ScenarioFogSeed } from './modules/seafarers/index.js';
import {
  CARAVANS_TARGET_VP,
  initialBarbarianAttackExt,
  initialCaravansExt,
  initialFishermenExt,
  initialRiversExt,
  initialTradersBarbariansMainExt,
  isBarbarianAttackConfig,
  isCaravansConfig,
  isFishermenConfig,
  isRiversConfig,
  isTradersBarbariansMainConfig,
} from './modules/tradersBarbarians/index.js';
import type { EngineError } from './reduce.js';
import { hashSeed, shuffle } from './rng.js';

/**
 * Config gate (docs/10 §1/§3, D-026): unshipped expansion toggles and 5–6 player counts without
 * their module are rejected — defense in depth against a modified client. Delegates to the
 * RuleModule registry (docs/10 §3), which is now the single source of truth for what's shipped.
 * Exposed so the server can pre-check a lobby config without try/catch.
 */
export function validateConfig(config: GameConfig): EngineError | null {
  const active = resolveModules(config);
  return active.ok ? null : active.error;
}

/** The 25-card (base) / 34-card (fiveSix) / +6 (cardMods, T-904) dev deck (R1.2/R9.1) from the
 *  resolved composition. `order` fixes a deterministic build order across every possible key —
 *  `composition` is a `Partial` (modules/types.ts), so a config without cardMods simply never
 *  populates the last 6 and `?? 0` skips them. */
function buildDevDeck(composition: Readonly<Partial<Record<AnyDevCardId, number>>>): AnyDevCardId[] {
  const order: readonly AnyDevCardId[] = [
    'knight',
    'roadBuilding',
    'yearOfPlenty',
    'monopoly',
    'victoryPoint',
    'bumperCrop',
    'merchantsBoon',
    'roadToll',
    'trailblazer',
    'windfall',
    'highwayman',
  ];
  const deck: AnyDevCardId[] = [];
  for (const type of order) {
    const count = composition[type] ?? 0;
    for (let i = 0; i < count; i++) deck.push(type);
  }
  return deck;
}

/**
 * Build the initial state. Deterministic: identical config (incl. seed) ⇒ deeply equal state
 * (D-004). Throws for an invalid config — the pinned signature (docs/02 §4) returns GameState,
 * so the coded error rides on the thrown Error as `.code`; callers who prefer a result can
 * pre-check with `validateConfig`.
 */
export function createGame(config: GameConfig): GameState {
  const invalid = validateConfig(config);
  if (invalid) {
    throw Object.assign(new Error(`${invalid.code}: ${invalid.message}`), { code: invalid.code });
  }

  const constants = resolveConstants(config);
  let rng = hashSeed(config.seed);

  // R2: terrain/token/harbor/robber layout. `config.board: 'beginner'` yields the fixed beginner
  // board (T-606, D-016-flagged) on the base 19-hex board; it throws coded EXPANSION_NOT_AVAILABLE
  // if combined with the 5–6 board (no verified 30-hex fixed layout), same thrown-coded-error
  // contract as above.
  // T-702: a shipped 3/4-player seafarers scenario builds its sea/land board (sea hexes produce
  // nothing) instead of the base 19-hex board; `hexTerrain` is the authoritative sea/gold/land map
  // that seeds `ext.seafarers`. Every other config (incl. an unsupported seafarers+5/6 combo, which
  // has no scenario board) uses the base/module board generator unchanged.
  // T-1107 (Explorers & Pirates, docs/rules/explorers-pirates-rules.md §EP2): Land Ho! (the first
  // shipped scenario) builds its own home-island + fog board instead of the base generator, exactly
  // parallel to the seafarers scenario branch above/below — v1 approximation, ⚠ VERIFY (see board.ts's
  // own header: `buildLandHoBoardV0` is reused here directly rather than a bespoke larger frame, given
  // it's already a real, valid `buildGeometry` coastline with a matching exploration-tile supply).
  // T-1111 generalizes this branch from a `landHo`-only check to ANY shipped E&P scenario (today:
  // `landHo` + `fishForHexhaven`, both reusing this same board+exploration seeding) — Land Ho! itself
  // takes the identical path it always did (`missions` all false ⇒ the fish/spice seeding below never
  // runs for it ⇒ its rng stream/ext are byte-identical to before this task, verified via RK-13 + the
  // Land Ho! sim digest).
  let board: GameState['board'];
  let seafarersHexTerrain: ScenarioTerrain[] | null = null;
  let seafarersPirate: HexId | null = null;
  let seafarersFog: ScenarioFogSeed | null = null;
  // The selected E&P scenario id (any declared id, shipped or not — `null` when E&P is off), computed
  // once up front since `explorersPiratesScenario` is a pure config read (no rng, no side effect).
  const epScenarioId: EPScenarioId | null = explorersPiratesScenario(config);
  let epSeaMap: ScenarioTerrain[] | null = null;
  let epUnexplored: HexId[] | null = null;
  let epExplorationSupply: EPTile[] | null = null;
  // T-1111 (§EP8/§EP9 mission framework): populated ONLY for a scenario whose `EP_SCENARIO_CONFIG`
  // entry enables the fish and/or spice mission (`seedFishSpiceV0` below) — `null` for Land Ho! (and
  // for every other config), same discipline as `seafarersFog`/`seafarersCloth` staying null/undefined
  // elsewhere in this function.
  let epFishShoals: HexId[] | null = null;
  let epVillages: HexId[] | null = null;
  let epCouncilVertex: VertexId | null = null;
  // T-757 (Cloth for Hexhaven): captured once here so the ext-building block below can gate the zeroed
  // `cloth` counter on `villages` presence without re-deriving the scenario board — `null` for every
  // other config (RK-13-adjacent, same as `seafarersFog` staying null elsewhere).
  const scenarioBoardData = scenarioBoardFor(config);
  if (scenarioBoardData) {
    const scenarioResult = generateScenarioBoard(rng, config);
    rng = scenarioResult.rng;
    board = scenarioResult.board;
    seafarersHexTerrain = scenarioResult.hexTerrain;
    seafarersPirate = scenarioResult.pirate;
    // T-756 (Fog Islands, S-analogue of E&P's exploration seed): seed the hidden-hex set + shuffled
    // reveal stack from the scenario board's `fog` data, threading `rng` further. `null` for every
    // other scenario (no `fog` block) — this task's data model touches nothing else, RK-13-adjacent.
    const fogSeed = seedScenarioFog(rng, config);
    if (fogSeed) {
      rng = fogSeed.rng;
      seafarersFog = fogSeed.fog;
    }
  } else if (epScenarioId !== null && SHIPPED_EP_SCENARIOS.has(epScenarioId)) {
    // T-1150 (Phase 11B): a `fiveSix` E&P config builds the BIGGER 5–6 frame (`buildLandHoBoard56`,
    // board.ts — its own board, unlike T&B's base-board reuse) + its matching bigger exploration-tile
    // table (`EP_EXPLORATION_TILES_56`); every other config (fiveSix off) takes the EXACT same path
    // it always did — `buildLandHoBoardV0`/`EP_EXPLORATION_TILES` — so 3–4 E&P/RK-13 stay
    // byte-identical. `resolveModules` already rejected any fiveSix+E&P combo whose scenario doesn't
    // declare 5–6 support (`EP_SCENARIO_SUPPORTS_56`) before `createGame` ever reaches this branch.
    const epBoard = config.expansions.fiveSix ? buildLandHoBoard56(rng) : buildLandHoBoardV0(rng);
    rng = epBoard.rng;
    board = epBoard.board;
    const epExplorationTiles = config.expansions.fiveSix ? EP_EXPLORATION_TILES_56 : EP_EXPLORATION_TILES;
    const explo = seedExplorationV0(rng, { seaMap: epBoard.seaMap }, epExplorationTiles);
    rng = explo.rng;
    epSeaMap = epBoard.seaMap;
    epUnexplored = explo.unexplored;
    epExplorationSupply = explo.explorationSupply;

    // T-1111 (§EP1.1 per-scenario mission framework): seed the fish/spice mission state ONLY when
    // this scenario's config turns on at least one of those two missions. Land Ho!'s `missions` are
    // all `false`, so this never runs for it — no extra `rng` draw, no extra `seaMap` read, nothing
    // for RK-13/the Land Ho! sim digest to notice. Uses the board's ORIGINAL `seaMap` (pre-reveal —
    // same input `seedFishSpiceV0`'s own tests craft directly, goldFishSpice.test.ts), not `epSeaMap`
    // post-exploration, though they're the same array reference at this point either way.
    //
    // T-1110 (fish-auto-haul fidelity fix, FOLLOWUPS.md): `seedFishSpiceV0` ALWAYS draws both the
    // shoal shuffle and the village shuffle whenever EITHER mission is on (unchanged rng cost/stream
    // from before this task — every board/dev-deck/etc. draw downstream is bit-identical for every
    // scenario). The LEAK this task closes is which of the three seeded fields actually get WRITTEN
    // into `ext.explorersPirates`: `epFishShoals` only when `missions.fish` is actually on, `epVillages`
    // only when `missions.spice` is actually on — previously BOTH were written whenever fish||spice was
    // true, so e.g. a spice-only game (Spices for Hexhaven) also got real `fishShoals`, letting
    // `haulFishOnArrival` (ships.ts) auto-haul + `deliverFish` (goldFishSpice.ts) score fish points that
    // scenario never intended. `epCouncilVertex` stays seeded whenever EITHER mission is on (unchanged)
    // — it's the ONE shared delivery vertex both `deliverFish`/`deliverSpice` target, per
    // `seedFishSpiceV0`'s own header. `deliverFishHandler`/`deliverSpiceHandler`/`haulFishOnArrival`
    // ALSO now explicitly re-check `epFishMissionActive`/`epSpiceMissionActive` themselves (defense in
    // depth for any hand-crafted/future state), so this seeding gate isn't the only thing closing the
    // leak — but it's what keeps the sim bot (sim/bot.ts's `fishShoalsOf`-driven ship-move preference)
    // from ever steering toward a shoal that shouldn't exist in that scenario at all.
    // T-1152 (Phase 11B): a `fiveSix` E&P config passes the resolved 5–6 geometry
    // (`LAND_HO_56_GEOMETRY`, 37 hexes) and the scaled `FISH_SHOAL_COUNT_56`/`VILLAGE_COUNT_56` counts
    // (goldFishSpice.ts, plumbed by T-1150) so `seedFishSpiceV0` seeds enough shoals/villages for the
    // bigger board and resolves `councilVertex` against the RIGHT geometry (the 3–4 default `GEOMETRY`
    // only has 19 hexes — indexing it with a 5–6 council hex id would silently resolve the wrong
    // vertex or find none at all). Every other config (fiveSix off) omits `opts` entirely, taking the
    // exact same default path as before this task — RK-13/3–4 E&P byte-identical.
    const missions = EP_SCENARIO_CONFIG[epScenarioId].missions;
    if (missions.fish || missions.spice) {
      const fishSpice = seedFishSpiceV0(
        rng,
        { seaMap: epBoard.seaMap },
        config.expansions.fiveSix
          ? { geometry: LAND_HO_56_GEOMETRY, fishShoalCount: FISH_SHOAL_COUNT_56, villageCount: VILLAGE_COUNT_56 }
          : undefined
      );
      rng = fishSpice.rng;
      epFishShoals = missions.fish ? fishSpice.fishShoals : null;
      epVillages = missions.spice ? fishSpice.villages : null;
      epCouncilVertex = fishSpice.councilVertex;
    }
  } else {
    // `shuffleNumbers` modifier (board-setup house rule): route through the R2.5 "shuffled" token
    // method (count-preserving permutation, no adjacent 6/8) instead of the default fixed spiral.
    // Gated strictly on the modifier so the default (no-modifier) path is bit-identical — RK-13.
    const boardConfig =
      config.modifiers?.shuffleNumbers === true ? { ...config, tokenMethod: 'shuffled' as const } : config;
    const boardResult = generateBoard(rng, boardConfig);
    rng = boardResult.rng;
    board = boardResult.board;
  }

  // S10.1: a seafarers scenario dictates its own victory-point target (14 for "Heading for New
  // Shores"), overriding whatever `config.targetVp` the lobby passed — the scenario rule is
  // authoritative. C1.1: Cities & Knights' 13-VP target is resolved the SAME way, but generically
  // through `constants.targetVp` (the citiesKnightsModule's `constants`, modules/citiesKnights/
  // index.ts) rather than a second scenario-shaped special case here. Base / fiveSix games keep
  // the config target unchanged (RK-13 bit-identity) since neither path applies.
  // T-1004 (Caravans, §TB4.4/TB1.3): a caravans game plays to 12 VP instead of the config value —
  // resolved the SAME way the seafarers scenario override is (a direct config-gated branch, since
  // `ModuleConstants.targetVp` is a single static value per MODULE and this module also serves
  // fishermen/rivers, which keep the base target). Every other config is unaffected (RK-13).
  // T-1107 (Explorers & Pirates, §EP1.3): Land Ho! plays to a fixed 8 VP, resolved the SAME way the
  // seafarers scenario / Caravans overrides are — a direct config-gated branch (every other config
  // unaffected, RK-13). T-1111 generalizes the lookup from the old hardcoded `EP_LANDHO_TARGET_VP`
  // constant to `EP_SCENARIO_CONFIG[epScenarioId].winTarget` — Land Ho! reads the exact same value
  // (8) it always did, since `EP_LANDHO_TARGET_VP` is now itself derived from that same config entry.
  const scenario = scenarioFor(config);
  const targetVp =
    constants.targetVp ??
    (scenario && seafarersHexTerrain
      ? scenario.targetVp
      : isCaravansConfig(config)
        ? CARAVANS_TARGET_VP
        : epScenarioId && epSeaMap
          ? EP_SCENARIO_CONFIG[epScenarioId].winTarget
          : config.targetVp);

  // R9.1: the deck is shuffled exactly once at game start; index 0 is the next draw.
  const deckResult = shuffle(rng, buildDevDeck(constants.devDeck));
  rng = deckResult.state;

  // T-802/C2.2/C12: a Cities & Knights game seeds its ext state (zeroed per-seat commodities/
  // improvements, shuffled progress decks, barbarian ship at the start of its track, robber locked
  // in the desert) here, mirroring how seafarers seeds `ext.seafarers` below. Threads `rng` the
  // same way the seafarers scenario board / dev-deck shuffle above do.
  let citiesKnightsExtInit: CitiesKnightsExt | undefined;
  if (config.expansions.citiesKnights) {
    const ckResult = initCitiesKnightsExt(config.playerCount, rng);
    rng = ckResult.rng;
    citiesKnightsExtInit = ckResult.ext;
  }

  // T-1002 (Fishermen, docs/rules/traders-barbarians-rules.md §TB2.1): seeds fish/oldBoot/lakeHex/
  // fishingGrounds AFTER the board above is built — the Lake is the board's own desert hex, so this
  // must run once `board` is final. Threads `rng` the same way the seafarers/C&K ext inits above do.
  // T-1003 (Rivers, §TB3.1): seeds coins/bridges/coinTradesThisTurn — no `rng` draw needed (river
  // edges are a fixed geometry constant, not randomized per game).
  // T-1004 (Caravans, §TB4.1): seeds oasisHex/routeEdges/camels — the Oasis is likewise the board's
  // own desert hex, so this runs once `board` is final too; no `rng` draw needed (the routes are a
  // pure function of the Oasis hex + fixed base geometry).
  // T-1005 (Barbarian Attack, §TB5.2): seeds the starting barbarian wave/knights/captured/gold — no
  // board mutation, no `rng` draw (the wave/advance path are pure functions of the fixed base
  // geometry, not randomized per game).
  let tradersBarbariansExtInit: NonNullable<GameState['ext']>['tradersBarbarians'];
  if (isFishermenConfig(config)) {
    // Phase 10B (T-1050): pass the config's RESOLVED geometry (base 19-hex, or the 30-hex
    // `GEOMETRY_EXT56` for a fiveSix+fishermen game) so the fishing grounds are computed against the
    // board actually in play, not always the base board (see `initialFishermenExt`'s header).
    const tbResult = initialFishermenExt(config.playerCount, rng, board, geometryForConfig(config));
    rng = tbResult.rng;
    tradersBarbariansExtInit = tbResult.ext;
  } else if (isRiversConfig(config)) {
    // Phase 10B (T-1051): pass the config's RESOLVED geometry (base 19-hex, or the 30-hex
    // `GEOMETRY_EXT56` for a fiveSix+rivers game) so the river edges/shore vertices/shore edges are
    // computed against the board actually in play, not always the base board (mirrors T-1050's
    // fishermen change above — see `initialRiversExt`'s header comment).
    tradersBarbariansExtInit = initialRiversExt(config.playerCount, geometryForConfig(config));
  } else if (isCaravansConfig(config)) {
    // Phase 10B (T-1053): pass the config's RESOLVED geometry (base 19-hex, or the 30-hex
    // `GEOMETRY_EXT56` for a fiveSix+caravans game) so the camel-route edges radiate from the Oasis
    // against the board actually in play, not always the base board (mirrors T-1050/T-1051/T-1052's
    // fishermen/rivers/barbarianAttack changes above — see `initialCaravansExt`'s header comment).
    tradersBarbariansExtInit = initialCaravansExt(board, geometryForConfig(config));
  } else if (isBarbarianAttackConfig(config)) {
    // Phase 10B (T-1052): pass the config's RESOLVED geometry (base 19-hex, or the 30-hex
    // `GEOMETRY_EXT56` for a fiveSix+barbarianAttack game) so the barbarian ring/center/march path
    // are computed against the board actually in play, not always the base board (mirrors T-1050/
    // T-1051's fishermen/rivers changes above — see `initialBarbarianAttackExt`'s header comment).
    tradersBarbariansExtInit = initialBarbarianAttackExt(config.playerCount, geometryForConfig(config));
  } else if (isTradersBarbariansMainConfig(config)) {
    // Phase 10B (T-1054): pass the config's RESOLVED geometry (base 19-hex, or the 30-hex
    // `GEOMETRY_EXT56` for a fiveSix+tradersBarbarians game) so the trade-hex placement/path-
    // barbarian-edge set are computed against the board actually in play, not always the base board
    // (mirrors T-1050/T-1051/T-1052/T-1053's fishermen/rivers/barbarianAttack/caravans changes above
    // — see `initialTradersBarbariansMainExt`'s header comment).
    tradersBarbariansExtInit = initialTradersBarbariansMainExt(config.playerCount, geometryForConfig(config));
  }

  // Built incrementally (rather than independent conditional spreads landing on the same `ext` key)
  // so a future combined-expansion config — a non-goal today, but not rejected by `resolveModules`
  // for every pair — could never have one silently clobber another.
  let ext: GameState['ext'];
  if (seafarersHexTerrain && seafarersPirate !== null) {
    // T-757 (Cloth for Hexhaven): a zeroed per-seat cloth counter, ONLY when the scenario board defines
    // `villages` — `undefined` for every other scenario, so `initialSeafarersExt` omits the field
    // entirely there (RK-13-adjacent, same discipline as `seafarersFog` above).
    const seafarersCloth = scenarioBoardData?.villages
      ? Array.from({ length: config.playerCount }, () => 0)
      : undefined;
    // T-758 (Pirate Islands): the auto-moving pirate's starting track index/safety, ONLY when the
    // scenario board defines `pirateTrack` — `undefined` for every other scenario (RK-13-adjacent,
    // same discipline as `seafarersCloth` above). The start index is wherever the generated pirate hex
    // (`seafarersPirate`, from `scenario.pirateStart`) sits in the resolved track — by data
    // construction that's always index 0 (PIRATE_ISLANDS_TRACK_5P/6P's first entry IS the frame's own
    // `pirateStart`), but this looks it up rather than assuming it.
    let pirateTrackInit: { index: number; safe: boolean } | undefined;
    if (scenarioBoardData?.pirateTrack) {
      const track = scenarioPirateTrackFor(config);
      const idx = Math.max(
        track.findIndex((t) => t.hex === seafarersPirate),
        0
      );
      const entry = track[idx];
      if (entry) pirateTrackInit = { index: idx, safe: entry.safe };
    }
    // T-758 (Pirate Islands): a zeroed per-seat lair-capture list, ONLY when the scenario board
    // defines `lairs` — `undefined` for every other scenario (same discipline as `seafarersCloth`).
    const seafarersLairs = scenarioBoardData?.lairs
      ? Array.from({ length: config.playerCount }, () => [] as HexId[])
      : undefined;
    // T-759 (Wonders of Hexhaven): a zeroed per-seat wonder-stage counter, ONLY for that scenario. Unlike
    // cloth/pirateTrack/lairs above, this mechanic needs no board data at all (it's purely per-seat
    // piece/hand bookkeeping, `modules/seafarers/wonder.ts`) — so it's gated directly on the scenario
    // id rather than a `scenarioBoardData` field, `undefined` for every other scenario/game
    // (RK-13-adjacent, same discipline as `seafarersCloth`/`seafarersLairs`).
    const seafarersWonder =
      scenario?.id === 'wondersOfHexhaven' ? Array.from({ length: config.playerCount }, () => 0) : undefined;
    ext = {
      ...ext,
      seafarers: initialSeafarersExt(
        config.playerCount,
        seafarersHexTerrain,
        seafarersPirate,
        seafarersFog ?? undefined,
        seafarersCloth,
        pirateTrackInit,
        seafarersLairs,
        seafarersWonder
      ),
    };
  }
  if (citiesKnightsExtInit) {
    ext = { ...ext, citiesKnights: citiesKnightsExtInit };
  }
  if (tradersBarbariansExtInit) {
    ext = { ...ext, tradersBarbarians: tradersBarbariansExtInit };
  }
  // T-1107 (Explorers & Pirates, §EP12.2): every shipped scenario seeds `seaMap`/`unexplored`/
  // `explorationSupply` (the board + fog) and an empty `ships` list. `harborSettlements`/
  // `settlerSupply`/`crewSupply`/gold/mission tracks are deliberately left unseeded here regardless —
  // every accessor in state.ts already defaults an absent field to `[]`/`0`, and `withEpExt` fills
  // them in lazily the first time a handler writes to them (buildEPSettler/upgradeToHarbor/etc.),
  // exactly like the seafarers/C&K ext inits above. T-1111 generalizes this from a `'landHo'`-literal
  // to the resolved `epScenarioId`, and additionally seeds `fishShoals`/`villages`/`councilVertex`
  // ONLY when `epFishShoals`/`epVillages`/`epCouncilVertex` were actually populated above — Land Ho!
  // (`missions` all false) leaves all three `null`, so its `ext.explorersPirates` block is
  // BYTE-IDENTICAL to before this task (verified via RK-13 + the Land Ho! sim digest).
  //
  // T-1110: each of the three fields is now gated INDEPENDENTLY (NOT one combined all-or-nothing
  // check as before this task) — `epFishShoals`/`epVillages` are each `null` unless THEIR OWN mission
  // is actually on (see this function's own comment above), while `epCouncilVertex` is non-null
  // whenever EITHER mission is on. A combined "`fishShoals !== null && villages !== null &&
  // councilVertex !== null`" check would incorrectly write NONE of the three for a single-mission
  // scenario (e.g. Spices for Hexhaven: `epFishShoals` is `null` there by design, which would have
  // zeroed out `councilVertex`/`villages` too under the old combined check — breaking spice delivery
  // entirely) — so each field is spread in independently below.
  if (epScenarioId && epSeaMap && epUnexplored && epExplorationSupply) {
    ext = {
      ...ext,
      explorersPirates: {
        scenario: epScenarioId,
        seaMap: epSeaMap,
        unexplored: epUnexplored,
        explorationSupply: epExplorationSupply,
        ships: [],
        ...(epFishShoals !== null ? { fishShoals: epFishShoals } : {}),
        ...(epVillages !== null ? { villages: epVillages } : {}),
        ...(epCouncilVertex !== null ? { councilVertex: epCouncilVertex } : {}),
      },
    };
  }

  // T-906 (docs/07 D-034 `customConstants.startingResources`): a bundle granted to EVERY player at
  // game start, debited from the bank so the I1 bank+hands invariant still holds exactly like a
  // production/build debit does. Absent ⇒ the zero bundle below (RK-13 bit-identity).
  const starting = constants.startingResources;
  const c = constants.bankPerResource;
  const bank = { brick: c, lumber: c, wool: c, grain: c, ore: c };
  if (starting) {
    for (const res of ['brick', 'lumber', 'wool', 'grain', 'ore'] as const) {
      const amt = starting[res] ?? 0;
      bank[res] -= amt * config.playerCount;
    }
  }

  const players: PlayerState[] = [];
  for (let s = 0; s < config.playerCount; s++) {
    const seat = s as Seat;
    const color = constants.seatColors[seat];
    if (color === undefined) throw new Error(`BUG: no color for seat ${seat}`);
    players.push({
      seat,
      color,
      resources: {
        brick: starting?.brick ?? 0,
        lumber: starting?.lumber ?? 0,
        wool: starting?.wool ?? 0,
        grain: starting?.grain ?? 0,
        ore: starting?.ore ?? 0,
      },
      devCards: [],
      playedKnights: 0,
      piecesLeft: { ...constants.piecesPerPlayer },
      roads: [],
      settlements: [],
      cities: [],
    });
  }

  return {
    v: 1,
    // Defensive copy so later caller mutations of the config object cannot alias into state.
    // `targetVp` is the scenario-resolved target for a seafarers game, else the config value.
    config: { ...config, targetVp, expansions: { ...config.expansions } },
    rng,
    board,
    bank,
    devDeck: deckResult.array,
    players,
    // R3.5: player 0 both opens the setup draft and takes turn 1 — the counter starts at 1 and
    // only advanceTurn moves it (the setup snake reorders turn.player without touching it).
    turn: { number: 1, player: 0, rolled: false, roll: null, devPlayed: false },
    phase: { kind: 'setup', round: 1, expect: 'settlement', lastSettlement: null },
    awards: {
      longestRoad: { holder: null, length: 0 },
      largestArmy: { holder: null, count: 0 },
    },
    trade: null,
    // Seafarers ship state (T-702) / Cities & Knights state (T-802) — present only for the
    // matching game; base state has no `ext` key at all, so base serialization/behavior stays
    // bit-identical (RK-13).
    ...(ext ? { ext } : {}),
    stateVersion: 0,
  };
}
