// Pure event -> log-line formatter (T-407 requirement 1, docs/03 §5). One branch per GameEvent
// type, with an exhaustive `never` check so a future event variant fails `pnpm -w typecheck` here
// FIRST (same pattern as hud/phaseText.ts's phaseTextKey). Every key returned comes from the
// T-306 log key catalog (`src/i18n/{en,tr}/log.json`) — this file owns and extends that catalog.
//
// Two deliberate deviations from the task's literal `(ev) => {icon,key,params} | null` sketch:
//
// 1. Returns `LogEntry[]` (never `null`) instead of a single nullable entry. `production` and
//    `discardRequired` each carry a PER-SEAT array (`gains`/`seats`) but the catalog's templates
//    (`log.production.gain`, `log.discardRequired`) are singular ("{{name}} collected...") — one
//    rendered line per seat, not one aggregated line. A singular return can't represent that
//    without inventing a multi-name template the catalog doesn't have, so this formats each
//    sub-item as its own entry. Every other event type still returns exactly one entry.
// 2. Takes `mySeat` as a second parameter. `stolen`'s ViewerEvent shape is identical whether the
//    viewer is the thief or the victim (both get the real `card`, per redact.ts) — picking between
//    `log.stolen.actor` ("you stole") and `log.stolen.viewer` ("stolen from you") is only possible
//    by comparing `ev.from`/`ev.to` against the viewer's own seat.
//
// Param values are "tagged" (`$seat`/`$bundle`/`$resourceCount`/`$resourceNames`/`$devCard`)
// rather than pre-resolved strings, so this file never needs `t()` or a seat->name lookup and
// stays trivially unit-testable (see formatEvent.test.ts). `logParams.ts`'s `resolveLogParams` is
// the one place that turns a tag into the final interpolation value at render time.
import type { AnyDevCardId, CardModComboId, ResourceBundle, ResourceType, Seat } from '@hexhaven/shared';
import type { ViewerEvent } from '@hexhaven/engine';

export type LogParamValue =
  | string
  | number
  | { $seat: Seat }
  | { $bundle: ResourceBundle }
  | { $resourceCount: { resource: ResourceType; count: number } }
  | { $resourceNames: ResourceType[] }
  | { $devCard: AnyDevCardId };

export interface LogEntry {
  icon: string;
  /** Dotted path within the `log` i18n namespace, e.g. `"built.settlement"`. */
  key: string;
  params: Record<string, LogParamValue>;
}

const seat = (s: Seat): LogParamValue => ({ $seat: s });
const bundle = (b: ResourceBundle): LogParamValue => ({ $bundle: b });
const resourceCount = (resource: ResourceType, count: number): LogParamValue => ({
  $resourceCount: { resource, count },
});
const resourceNames = (types: ResourceType[]): LogParamValue => ({ $resourceNames: types });
const devCard = (card: AnyDevCardId): LogParamValue => ({ $devCard: card });

// T-904 (cardMods modifier): the 6 curated new dev-card types get their own icon; the 5 combo ids
// (never bought, only played) share the generic combo glyph. `Partial` + a fallback (rather than a
// full `Record`) keeps this from needing every id spelled out redundantly with the base 5's icons.
const DEV_CARD_ICON: Partial<Record<AnyDevCardId | CardModComboId, string>> = {
  knight: '⚔️',
  roadBuilding: '🛠️',
  yearOfPlenty: '🌾',
  monopoly: '💰',
  victoryPoint: '⭐',
  bumperCrop: '🌽',
  merchantsBoon: '⚖️',
  roadToll: '🧾',
  trailblazer: '🥾',
  windfall: '🍂',
  highwayman: '🗡️',
  rideByNight: '🌙',
  nightOfPlenty: '🌕',
  monorail: '🚈',
  megaKnight: '🛡️',
  superSettle: '🏰',
};
const DEFAULT_DEV_CARD_ICON = '🃏';

function one(icon: string, key: string, params: Record<string, LogParamValue> = {}): LogEntry[] {
  return [{ icon, key, params }];
}

/** Reads a `VpBreakdown`-shaped value defensively — `gameWon.vpBreakdown` is typed `unknown` on
 * the wire (packages/shared/src/protocol/messages.ts), so this never assumes the shape. */
function vpTotal(vpBreakdown: unknown): number {
  if (typeof vpBreakdown === 'object' && vpBreakdown !== null && 'total' in vpBreakdown) {
    const total = (vpBreakdown as { total: unknown }).total;
    if (typeof total === 'number') return total;
  }
  return 0;
}

export function formatEvent(ev: ViewerEvent, mySeat: Seat): LogEntry[] {
  switch (ev.type) {
    case 'gameStarted':
      return one('🎮', 'gameStarted');

    case 'setupPlaced':
      return one(ev.piece === 'settlement' ? '🏠' : '🛤️', `setupPlaced.${ev.piece}`, {
        name: seat(ev.seat),
      });

    case 'startingResources':
      return one('🎁', 'startingResources', { name: seat(ev.seat), resources: bundle(ev.gained) });

    case 'diceRolled':
      return one('🎲', 'diceRolled', {
        name: seat(ev.seat),
        d1: ev.roll[0],
        d2: ev.roll[1],
        total: ev.roll[0] + ev.roll[1],
      });

    case 'production': {
      const entries: LogEntry[] = ev.gains.map((g) => ({
        icon: '📦',
        key: 'production.gain',
        params: { name: seat(g.seat), resources: bundle(g.resources) },
      }));
      if (ev.shortages.length > 0) {
        entries.push({
          icon: '⚠️',
          key: 'production.shortage',
          params: { resources: resourceNames(ev.shortages) },
        });
      }
      return entries;
    }

    case 'discardRequired':
      return ev.seats.map((s) => ({
        icon: '🗑️',
        key: 'discardRequired',
        params: { name: seat(s.seat), amount: s.amount },
      }));

    case 'discarded':
      return 'cards' in ev
        ? one('🗑️', 'discarded.self', { resources: bundle(ev.cards) })
        : one('🗑️', 'discarded.other', { name: seat(ev.seat), count: ev.count });

    case 'robberMoved':
      return one('🥷', 'robberMoved', { name: seat(ev.seat) });

    case 'stolen': {
      if ('card' in ev) {
        return ev.from === mySeat
          ? one('🕵️', 'stolen.actor', { resource: resourceCount(ev.card, 1), from: seat(ev.to) })
          : one('🕵️', 'stolen.viewer', { name: seat(ev.from), resource: resourceCount(ev.card, 1) });
      }
      return one('🕵️', 'stolen.other', { name: seat(ev.from), from: seat(ev.to) });
    }

    case 'built': {
      const icon = ev.piece === 'road' ? '🛤️' : ev.piece === 'settlement' ? '🏠' : '🏛️';
      return one(icon, `built.${ev.piece}`, { name: seat(ev.seat) });
    }

    // Seafarers ships (S4/S7, T-702). Full ship rendering is T-704/705; these keep the event log
    // complete (and the GameEvent switch exhaustive) with data-only, translated log lines.
    case 'shipBuilt':
      return one('⛵', 'shipBuilt', { name: seat(ev.seat) });

    case 'shipMoved':
      return one('⛵', 'shipMoved', { name: seat(ev.seat) });

    // Seafarers pirate / gold / island chits (S8/S9/S10.6, T-703). Full rendering is T-704/705;
    // these keep the event log complete + the switch exhaustive with data-only, translated lines.
    case 'pirateMoved':
      return one('🏴‍☠️', 'pirateMoved', { name: seat(ev.seat) });

    case 'goldChosen':
      return one('🪙', 'goldChosen', { name: seat(ev.seat), resources: bundle(ev.picks) });

    case 'islandSettled':
      return one('🏝️', 'islandSettled', { name: seat(ev.seat), vp: ev.vp });

    case 'devBought':
      return 'card' in ev
        ? one('🃏', 'devBought.self', { card: devCard(ev.card) })
        : one('🃏', 'devBought.other', { name: seat(ev.seat) });

    case 'devPlayed':
      return one(DEV_CARD_ICON[ev.card] ?? DEFAULT_DEV_CARD_ICON, `devPlayed.${ev.card}`, { name: seat(ev.seat) });

    case 'monopolyResolved': {
      const total = ev.taken.reduce((sum, taken) => sum + taken.count, 0);
      return one('💰', 'monopolyResolved', {
        name: seat(ev.seat),
        resources: resourceCount(ev.resource, total),
      });
    }

    case 'bankTraded':
      return one('🏦', 'bankTraded', {
        name: seat(ev.seat),
        gave: bundle(ev.gave),
        got: bundle(ev.got),
      });

    case 'tradeOffered':
      return one('🤝', 'tradeOffered', {
        name: seat(ev.from),
        give: bundle(ev.give),
        receive: bundle(ev.receive),
      });

    case 'tradeResponded':
      return one(ev.response === 'accepted' ? '✅' : '❌', `tradeResponded.${ev.response}`, {
        name: seat(ev.responder),
      });

    case 'tradeCompleted':
      return one('🤝', 'tradeCompleted', {
        name: seat(ev.from),
        withName: seat(ev.with),
        give: bundle(ev.give),
        receive: bundle(ev.receive),
      });

    case 'tradeCancelled':
      return one('🚫', 'tradeCancelled');

    case 'awardMoved': {
      // longestRoad 🛣️ · harbormaster ⚓ (modifier award, docs/07 D-034) · largestArmy ⚔️.
      const icon = ev.award === 'longestRoad' ? '🛣️' : ev.award === 'harbormaster' ? '⚓' : '⚔️';
      if (ev.holder === null) {
        return one(icon, `awardMoved.${ev.award}Cleared`);
      }
      return one(icon, `awardMoved.${ev.award}`, { name: seat(ev.holder), value: ev.value });
    }

    case 'turnEnded':
      return one('🔁', 'turnEnded', { name: seat(ev.seat), nextName: seat(ev.next) });

    // 5–6 extension extra-build events (X12, T-603).
    case 'specialBuildStarted':
      return one('🔨', 'specialBuildStarted', { name: seat(ev.builder) });

    case 'specialBuildPassed':
      return one('⏭️', 'specialBuildPassed', { name: seat(ev.seat) });

    case 'pairedBuildStarted':
      return one('👥', 'pairedBuildStarted', { name: seat(ev.builder) });

    case 'pairedBuildEnded':
      return one('⏭️', 'pairedBuildEnded', { name: seat(ev.seat) });

    case 'gameWon':
      return one('🏁', 'gameWon', { name: seat(ev.seat), vp: vpTotal(ev.vpBreakdown) });

    // Cities & Knights (T-802, docs/rules/cities-knights-rules.md). Not yet client-selectable
    // (`SHIPPED_EXPANSIONS.citiesKnights` stays false, apps/client/src/options/OptionsPanel.tsx) —
    // these keep the event log complete + the GameEvent switch exhaustive with data-only,
    // translated lines, same as the Seafarers ship/pirate placeholders above; full rendering is a
    // later task.
    case 'commodityProduction': {
      const entries: LogEntry[] = ev.gains.map((g) => ({
        icon: '📜',
        key: 'commodityProduction.gain',
        params: { name: seat(g.seat) },
      }));
      if (ev.shortages.length > 0) {
        entries.push({ icon: '⚠️', key: 'commodityProduction.shortage', params: {} });
      }
      return entries;
    }

    case 'aqueductGranted':
      return one('🏺', 'aqueductGranted', { name: seat(ev.seat), resource: resourceCount(ev.resource, 1) });

    case 'improvementBuilt':
      return one('📜', 'improvementBuilt', { name: seat(ev.seat) });

    case 'metropolisPlaced':
      return one('🏙️', 'metropolisPlaced', { name: seat(ev.seat) });

    case 'metropolisCaptured':
      return one('🏙️', 'metropolisCaptured', { name: seat(ev.to), fromName: seat(ev.from) });

    case 'commodityTraded':
      return one('🏦', 'commodityTraded', { name: seat(ev.seat) });

    // Cities & Knights knights/barbarians (T-803). Same "hidden but present" discipline as the
    // T-802 block above — full rendering is a later task.
    case 'eventDieRolled':
      return one('🎲', 'eventDieRolled', { name: seat(ev.seat) });

    case 'barbarianAdvanced':
      return one('🚢', 'barbarianAdvanced', { position: ev.position });

    case 'progressGateOpened':
      return one('🎴', 'progressGateOpened', {});

    case 'barbarianAttackResolved':
      return one('⚔️', `barbarianAttackResolved.${ev.result}`, {});

    case 'knightBuilt':
      return one('🛡️', 'knightBuilt', { name: seat(ev.seat) });

    case 'knightActivated':
      return one('🛡️', 'knightActivated', { name: seat(ev.seat) });

    case 'knightPromoted':
      return one('🛡️', 'knightPromoted', { name: seat(ev.seat) });

    case 'knightMoved':
      return one('🛡️', 'knightMoved', { name: seat(ev.seat) });

    case 'knightDisplaced':
      return one('🛡️', 'knightDisplaced', { name: seat(ev.seat) });

    // Cities & Knights progress cards (T-804). Same "hidden but present" discipline as the T-802/
    // T-803 blocks above — full rendering is a later task.
    case 'progressCardDrawn':
      return 'card' in ev
        ? one('🎴', 'progressCardDrawn.self', { name: seat(ev.seat) })
        : one('🎴', 'progressCardDrawn.other', { name: seat(ev.seat) });

    case 'progressCardRevealed':
      return one('⭐', 'progressCardRevealed', { name: seat(ev.seat) });

    case 'progressCardDiscarded':
      return one('🗑️', 'progressCardDiscarded', { name: seat(ev.seat) });

    case 'progressCardPlayed':
      return one('🎴', 'progressCardPlayed', { name: seat(ev.seat) });

    case 'progressCardsTransferred':
      return one('🔄', 'progressCardsTransferred', { name: seat(ev.to), fromName: seat(ev.from) });

    case 'progressCardTaken':
      return one('🕵️', 'progressCardTaken', { name: seat(ev.to), fromName: seat(ev.from) });

    case 'merchantPlaced':
      return one('🏪', 'merchantPlaced', { name: seat(ev.seat) });

    case 'cityWallBuilt':
      return one('🧱', 'cityWallBuilt', { name: seat(ev.seat) });

    case 'knightRemoved':
      return one('🛡️', 'knightRemoved', { name: seat(ev.seat) });

    case 'roadRemoved':
      return one('🛤️', 'roadRemoved', { name: seat(ev.seat) });

    case 'numberTokensSwapped':
      return one('🔀', 'numberTokensSwapped', {});

    case 'commodityMonopolyResolved':
      return one('💰', 'commodityMonopolyResolved', { name: seat(ev.seat) });

    // "The Helpers of Hexhaven" modifier (T-905). Same "hidden but present" discipline as the Cities &
    // Knights blocks above — data-only, translated lines; a dedicated Helpers HUD is a later task.
    case 'helperDealt':
      return one('🧑‍🤝‍🧑', 'helperDealt', { name: seat(ev.seat) });

    case 'helperUsed':
      return one('🧑‍🤝‍🧑', 'helperUsed', { name: seat(ev.seat) });

    case 'helperSwapped':
      return one('🔄', 'helperSwapped', { name: seat(ev.seat) });

    // Event Cards modifier (T-904b): fires ALONGSIDE the usual `diceRolled` (whose synthetic roll
    // pair sums to `ev.total`) — this is the line the log shows in place of "rolled a + b".
    case 'eventCardDrawn':
      return one('🎴', 'eventCardDrawn', { name: seat(ev.seat), total: ev.total });

    // Multi-piece hex framework (T-902, docs/07 D-034): move-any + the Wizard's production top-up.
    case 'hexPieceMoved':
      return one('🧙', `hexPieceMoved.${ev.piece}`, { name: seat(ev.seat) });

    case 'hexPieceProduction':
      return ev.gains.map((g) => ({
        icon: '🧙',
        key: `hexPieceProduction.${ev.piece}`,
        params: { name: seat(g.seat), resources: bundle({ [ev.resource]: g.amount }) },
      }));

    // Traders & Barbarians — Fishermen (T-1002, docs/rules/traders-barbarians-rules.md §TB2). Data-
    // only entries, same "present but not yet a dedicated HUD" discipline as the Helpers/hexPieces
    // blocks above — a fishermen-specific log/HUD treatment is T-1008's to build.
    case 'fishProduced':
      return ev.gains.map((g) => ({
        icon: '🐟',
        key: 'fishProduced',
        params: { name: seat(g.seat), count: g.amount },
      }));

    case 'oldBootAwarded':
      return one('🥾', 'oldBootAwarded', { name: seat(ev.seat) });

    case 'oldBootPassed':
      return one('🥾', 'oldBootPassed', { name: seat(ev.from), target: seat(ev.to) });

    case 'fishExchanged':
      return one('🐟', `fishExchanged.${ev.benefit}`, { name: seat(ev.seat) });

    // Traders & Barbarians — Rivers (T-1003, docs/rules/traders-barbarians-rules.md §TB3). Data-only
    // entries, same "present but not yet a dedicated HUD" discipline as the Fishermen block above —
    // a rivers-specific log/HUD treatment is T-1008's to build.
    case 'bridgeBuilt':
      return one('🌉', 'bridgeBuilt', { name: seat(ev.seat) });

    case 'coinsAwarded':
      return one('🪙', `coinsAwarded.${ev.source}`, { name: seat(ev.seat), count: ev.amount });

    case 'coinsTraded':
      return one('🪙', 'coinsTraded', {
        name: seat(ev.seat),
        gave: ev.gave,
        resources: bundle({ [ev.received]: 1 }),
      });

    // Traders & Barbarians — Caravans (T-1004, docs/rules/traders-barbarians-rules.md §TB4). Same
    // "present but not yet a dedicated HUD" discipline as the Fishermen/Rivers blocks above — a
    // caravans-specific log/HUD treatment is T-1008's to build.
    case 'caravanVoteOpened':
      return one('🐫', 'caravanVoteOpened', { name: seat(ev.builder) });

    case 'caravanVoteCast':
      return one('🐫', 'caravanVoteCast', { name: seat(ev.seat), count: ev.bid });

    case 'caravanVoteResolved':
      return ev.winner === null
        ? one('🐫', 'caravanVoteResolved.none', {})
        : one('🐫', 'caravanVoteResolved.winner', { name: seat(ev.winner) });

    case 'camelPlaced':
      return one('🐫', 'camelPlaced', { name: seat(ev.seat) });

    // Traders & Barbarians — Barbarian Attack (T-1005, docs/rules/traders-barbarians-rules.md
    // §TB5). Same "present but not yet a dedicated HUD" discipline as the other T&B blocks above —
    // a barbarianAttack-specific log/HUD treatment is T-1008's to build.
    case 'tbKnightRecruited':
      return one('⚔️', 'tbKnightRecruited', { name: seat(ev.seat) });

    case 'tbKnightMoved':
      return one('⚔️', 'tbKnightMoved', { name: seat(ev.seat) });

    case 'tbBarbariansAdvanced':
      return one('🪓', 'tbBarbariansAdvanced', { count: ev.moves.length });

    case 'tbBarbarianCombatResolved':
      return one('⚔️', 'tbBarbarianCombatResolved', { count: ev.barbariansDefeated });

    case 'tbBarbarianPillaged':
      return one('🪓', `tbBarbarianPillaged.${ev.downgraded}`, { name: seat(ev.seat) });

    case 'tbBarbarianDispersed':
      return one('🪓', 'tbBarbarianDispersed', {});

    // Traders & Barbarians — the main scenario (T-1006, docs/rules/traders-barbarians-rules.md
    // §TB6). Same "present but not yet a dedicated HUD" discipline as the other T&B blocks above —
    // a main-scenario-specific log/HUD treatment is T-1008's to build.
    case 'tbWagonPlaced':
      return one('🛒', 'tbWagonPlaced', { name: seat(ev.seat) });

    case 'tbWagonMoved':
      return one('🛒', 'tbWagonMoved', { name: seat(ev.seat) });

    case 'tbCommodityProduced':
      return ev.gains.map((g) => ({
        icon: '🧱',
        key: 'tbCommodityProduced',
        params: { name: seat(g.seat) },
      }));

    case 'tbDeliveryCompleted':
      return one('🏰', `tbDeliveryCompleted.${ev.kind}`, { name: seat(ev.seat) });

    // Explorers & Pirates — ship movement + crew/cargo (T-1102, docs/rules/
    // explorers-pirates-rules.md §EP3). Same "present but not yet a dedicated HUD" discipline as the
    // T&B blocks above — an E&P-specific log/HUD treatment is T-1109's to build.
    case 'epShipBuilt':
      return one('⛵', 'epShipBuilt', { name: seat(ev.seat) });

    case 'epShipMoved':
      return one('⛵', 'epShipMoved', { name: seat(ev.seat) });

    case 'epCargoLoaded':
      return one('📦', 'epCargoLoaded', { name: seat(ev.seat) });

    case 'epCargoUnloaded':
      return one('📦', 'epCargoUnloaded', { name: seat(ev.seat) });

    // Explorers & Pirates — exploration + fog (T-1103, docs/rules/explorers-pirates-rules.md
    // §EP5/§EP12.4). Same "present but not yet a dedicated HUD" discipline as the other E&P/T&B
    // blocks above — an E&P-specific log/HUD treatment is T-1109's to build. `tile`'s contents are
    // already public once this event exists (EP5.1: reveals are known to ALL players) — nothing to
    // redact here, unlike the hand-revealing event types earlier in this switch.
    case 'epTileRevealed':
      return one('🗺️', 'epTileRevealed', { name: seat(ev.seat) });

    // Explorers & Pirates — settlers, founding & harbor settlements (T-1104, docs/rules/
    // explorers-pirates-rules.md §EP4). Same "present but not yet a dedicated HUD" discipline as the
    // other E&P blocks above — an E&P-specific log/HUD treatment is T-1109's to build.
    case 'epSettlerBuilt':
      return one('🧑', 'epSettlerBuilt', { name: seat(ev.seat) });

    case 'epSettlementFounded':
      return one('🏠', 'epSettlementFounded', { name: seat(ev.seat) });

    case 'epHarborSettlementBuilt':
      return one('⚓', 'epHarborSettlementBuilt', { name: seat(ev.seat) });

    // Explorers & Pirates — crews & the Pirate Lairs mission (T-1105, docs/rules/
    // explorers-pirates-rules.md §EP7). Same "present but not yet a dedicated HUD" discipline as the
    // other E&P blocks above — an E&P-specific log/HUD treatment is T-1109's to build.
    case 'epCrewBuilt':
      return one('🏴', 'epCrewBuilt', { name: seat(ev.seat) });

    case 'epCrewPlacedOnLair':
      return one('🏴', 'epCrewPlacedOnLair', { name: seat(ev.seat) });

    case 'epLairCaptured':
      return one('🏴', 'epLairCaptured', {});

    // Explorers & Pirates — fish/spice missions & the gold economy (T-1106, docs/rules/
    // explorers-pirates-rules.md §EP6/§EP8/§EP9). Same "present but not yet a dedicated HUD"
    // discipline as the other E&P blocks above — an E&P-specific log/HUD treatment is T-1109's to
    // build.
    case 'epGoldCompensated':
      return one('🪙', 'epGoldCompensated', {});

    case 'epGoldShipped':
      return one('🪙', 'epGoldShipped', { name: seat(ev.seat) });

    case 'epFishHauled':
      return one('🐟', 'epFishHauled', { name: seat(ev.seat) });

    case 'epFishDelivered':
      return one('🐟', 'epFishDelivered', { name: seat(ev.seat) });

    case 'epSpiceTraded':
      return one('🌶️', 'epSpiceTraded', { name: seat(ev.seat) });

    case 'epSpiceDelivered':
      return one('🌶️', 'epSpiceDelivered', { name: seat(ev.seat) });

    default: {
      const exhaustiveCheck: never = ev;
      throw new Error(`BUG: formatEvent missing a case for ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
