// Scoreboard (T-402 / RK-17): the compact per-player table in the game sidebar — one row each with
// cards, dev cards, knights and VP toward the target. Extracted from routes/Game.tsx (T-603) so it
// can be unit-rendered at 5–6 players (proving the HUD re-flows to seat six without dropping any
// information). Own row uses the full VP total (incl. hidden VP cards); opponents show public VP
// only (R13.2 — never leak hidden cards). Current turn is highlighted; longest-road / largest-army
// holders and disconnected/discarding seats are marked. Purely presentational: every player row is
// driven off `view.players`, so it seats however many players the game has (no 4-seat assumption).
//
// Playtest fix (rail redesign): now ALSO carries the compact turn indicator ("Turn N — name") that
// used to live in the removed `hud/DicePanel.tsx` (the user didn't want a persistent dice box
// sitting in the rail; only the center-screen `DiceRollOverlay` animation remains) — this is the one
// piece of that panel worth keeping, so it rides the table this component already owns instead of a
// standalone box.
import { useTranslation } from 'react-i18next';
import type { OtherPlayerView, PlayerView } from '@hexhaven/engine';
import type { Seat } from '@hexhaven/shared';
import { bundleTotal, LIMITLESS_CAP } from '@hexhaven/shared';
import { PLAYER_BADGES, PLAYER_COLORS } from '../board/palette';
import { TRACK_COLOR } from '../board/citiesKnightsPalette';
import { IMPROVEMENT_TRACKS, ckOf } from '../citiesKnights/ckHelpers';
import {
  isAnyEpMissionActive,
  isExplorersPiratesGame,
  isFishMissionActive,
  isPirateLairsMissionActive,
  isSpiceMissionActive,
} from '../explorersPirates/epHelpers';
import { Tooltip } from '../ui';
import { DEV_CARD_BACK_GLYPH, KNIGHT_GLYPH, RESOURCE_BACK_GLYPH } from './constants';
import {
  caravansHudVp,
  computeClothVp,
  computeEpFishVp,
  computeEpGoldVp,
  computeEpHarborVp,
  computeEpLairVp,
  computeEpSpiceVp,
  computeExtraVp,
  computeIslandChitVp,
  computeLairVp,
  computeOwnVp,
  computePublicVp,
  computeWonderVp,
  epCapturedLairCount,
  epSpiceBenefitLevel,
  tbWinTargetBonus,
} from './vp';

function isOtherPlayerView(p: PlayerView['players'][number]): p is OtherPlayerView {
  return 'resourceCount' in p;
}

// Scoreboard column glyphs (pictograms, referenced as expressions so the i18n-guard doesn't treat
// them as raw copy). Card/dev/knight reuse the HUD's own glyphs; the rest are local.
const VP_GLYPH = '🏆';
const ROAD_GLYPH = '🛣️'; // longest-road holder
const ARMY_GLYPH = '🛡️'; // largest-army holder
const DISCONNECT_GLYPH = '⚠';
const PAIR1_GLYPH = '➊'; // Paired Players (X12): the active "player 1" this round
const PAIR2_GLYPH = '➋'; // Paired Players (X12): "player 2" (takes the partial turn), paired with ➊
const CHIT_GLYPH = '⛵'; // Seafarers (S10.6): the seat holds one or more small-island bonus chits
const CLOTH_GLYPH = '🧵'; // Cloth for Hexhaven (T-757): the seat's cloth-derived VP (floor(cloth/2))
const LAIR_GLYPH = '💀'; // The Pirate Islands (T-758): the seat's captured-lair VP
const WONDER_GLYPH = '🗿'; // The Wonders of Hexhaven (T-759): the seat's wonder-stage VP
const HARBORMASTER_GLYPH = '⚓'; // harbormaster modifier (docs/07 D-034): the +2 award holder
const IMPROVEMENTS_GLYPH = '🏛️'; // Cities & Knights (rail redesign): the folded-in improvement-track column
const OLD_BOOT_GLYPH = '👢'; // Fishermen (§TB2.5): the Old Boot catch-up marker (+1 VP to win)
const WEALTHIEST_GLYPH = '💰'; // Rivers (§TB3.4): Wealthiest Settler (+1 VP)
const POOREST_GLYPH = '🪙'; // Rivers (§TB3.4): Poorest Settler (-2 VP)
const EP_FISH_GLYPH = '🐟'; // Explorers & Pirates (T-1155, §EP8): fish-mission delivery VP
const EP_SPICE_GLYPH = '🌶️'; // Explorers & Pirates (T-1155, §EP9): spice-mission delivery VP
const EP_LAIR_GLYPH = '🏴‍☠️'; // Explorers & Pirates (T-1155, §EP7.2): Pirate Lairs mission capture VP
const EP_GOLD_GLYPH = '🥇'; // Explorers & Pirates (T-1155, §EP6.2): shipGold VP
const EP_HARBOR_GLYPH = '🏘️'; // Explorers & Pirates (T-1155, §EP4.2): harbor-settlement VP

export interface ScoreboardProps {
  view: PlayerView;
  me: Seat;
  seatName: (seat: Seat) => string;
  presence: Partial<Record<Seat, boolean>>;
  discardAmountFor: (seat: Seat) => number | undefined;
}

export function Scoreboard({ view, me, seatName, presence, discardAmountFor }: ScoreboardProps) {
  const { t } = useTranslation(['game', 'citiesKnights', 'tradersBarbarians']);
  // An "Unlimited" custom target resolves to the finite LIMITLESS_CAP sentinel — show it as ∞ rather
  // than a bewildering 100000 (playtest: merged Custom Target VP with an unlimited option).
  const target = view.config.targetVp;
  const cell = 'px-1 py-1 text-center tabular-nums';

  // Traders & Barbarians (T-1008): Rivers' Wealthiest/Poorest badges (§TB3.4) — recomputed FRESH
  // every render straight from the public `ext.tradersBarbarians.coins`, mirroring the engine's own
  // `riversVpFor` tie rules (sole max -> wealthiest; every tied-min -> poorest; both 0 while nobody
  // has ANY coins yet). The Old Boot holder (§TB2.5) is a bare marker lookup.
  const tbCoins = view.ext?.tradersBarbarians?.scenario === 'rivers' ? (view.ext.tradersBarbarians.coins ?? []) : [];
  const maxCoins = tbCoins.length > 0 ? Math.max(...tbCoins) : 0;
  const minCoins = tbCoins.length > 0 ? Math.min(...tbCoins) : 0;
  const wealthiestLeaders = tbCoins.filter((c) => c === maxCoins).length;
  const oldBootHolder = view.ext?.tradersBarbarians?.scenario === 'fishermen' ? view.ext.tradersBarbarians.oldBoot : null;
  // Rail redesign (requirement 4): a Cities & Knights game used to render a FULL per-seat block
  // (commodities + all 3 tracks) for every player in `CitiesKnightsHud` — "the biggest offender" for
  // rail overflow. That component now shows only the VIEWER's own detail; every OTHER seat's
  // improvement levels fold into this table instead, as one compact column (3 tiny track badges).
  const ck = ckOf(view);

  // Explorers & Pirates (T-1155, §EP1.3/§EP6.2/§EP7.2/§EP8/§EP9): which mission point-track badges to
  // show — reuses `epHelpers`'s own mission-active predicates (the same ones T-1154's action panel
  // gates its controls on) so a track NEVER shows for a scenario that can't actually score it (Land
  // Ho! has no missions at all; the full campaign has all three). `epGame` additionally gates the
  // unconditional (not mission-gated) harbor-settlement VP badge — that one scores in Land Ho! too.
  const epFishOn = isFishMissionActive(view);
  const epSpiceOn = isSpiceMissionActive(view);
  const epLairOn = isPirateLairsMissionActive(view);
  const epGoldOn = isAnyEpMissionActive(view);
  const epGame = isExplorersPiratesGame(view);
  const epLairsCaptured = epLairOn ? epCapturedLairCount(view) : 0;

  // Paired Players (X12): show which two seats are the ➊/➋ duo THIS round so the pairing is visible.
  // During the partial turn the marker rides on `view.ext`; during player 1's full turn player 2 is
  // the 3rd seat to the left (mirrors the engine's `(p1 + 3) % n`).
  const pairedMode = view.config.variants?.fiveSixTurnRule === 'pairedPlayers';
  const partialTurn = view.ext?.fiveSix?.partialTurn ?? null;
  let pair1: Seat | null = null;
  let pair2: Seat | null = null;
  if (pairedMode) {
    if (partialTurn) {
      pair1 = partialTurn.resumeFrom;
      pair2 = partialTurn.builder;
    } else {
      pair1 = view.turn.player;
      pair2 = ((view.turn.player + 3) % view.config.playerCount) as Seat;
    }
  }
  return (
    <div className="hexhaven-panel p-2" data-testid="scoreboard">
      <p className="mb-1 truncate font-ui text-12 font-semibold text-ink-soft" data-testid="scoreboard-turn-indicator">
        {t('hud.turn.indicator', { number: view.turn.number, name: seatName(view.turn.player) })}
      </p>
      {epLairOn ? (
        <p className="mb-1 truncate font-ui text-11 text-ink-soft" data-testid="scoreboard-ep-lairs-captured">
          {t('hud.ep.lairsCaptured', { count: epLairsCaptured })}
        </p>
      ) : null}
      <table className="w-full border-collapse font-ui text-12">
        <thead>
          <tr className="text-ink-soft">
            <th className="px-1 py-1 text-left font-medium" />
            <th className={cell} aria-hidden="true">{RESOURCE_BACK_GLYPH}</th>
            <th className={cell} aria-hidden="true">{DEV_CARD_BACK_GLYPH}</th>
            <th className={cell} aria-hidden="true">{KNIGHT_GLYPH}</th>
            {ck ? <th className={cell} aria-hidden="true">{IMPROVEMENTS_GLYPH}</th> : null}
            <th className={cell} aria-hidden="true">{VP_GLYPH}</th>
          </tr>
        </thead>
        <tbody>
          {view.players.map((p) => {
            const other = isOtherPlayerView(p);
            const isMe = p.seat === me;
            const cards = other ? p.resourceCount : bundleTotal(p.resources);
            const dev = other ? p.devCardCount : p.devCards.length;
            // Island chits are public (S10.6), so every seat's shown total includes them — matching
            // the engine's authoritative VP, which already folds chits in.
            const chitVp = computeIslandChitVp(view, p.seat);
            const clothVp = computeClothVp(view, p.seat);
            const lairVp = computeLairVp(view, p.seat);
            const wonderVp = computeWonderVp(view, p.seat);
            const extraVp = computeExtraVp(view, p.seat);
            const caravansVp = caravansHudVp(view, p.seat);
            // Explorers & Pirates (T-1155): the four mission point tracks + the unconditional
            // harbor-settlement VP — each getter already returns 0 outside its own mission/game, so
            // these are safe to add unconditionally (mirrors `chitVp`/`clothVp` above).
            const epFishVp = computeEpFishVp(view, p.seat);
            const epSpiceVp = computeEpSpiceVp(view, p.seat);
            const epSpiceLevel = epSpiceBenefitLevel(view, p.seat);
            const epLairVp = computeEpLairVp(view, p.seat);
            const epGoldVp = computeEpGoldVp(view, p.seat);
            const epHarborVp = computeEpHarborVp(view, p.seat);
            const ownVp = isMe && !other ? computeOwnVp(p, view.awards) : null;
            const baseVp = ownVp ? ownVp.totalWithHidden : computePublicVp(p, view.awards).total;
            // Fold in the same modifier/C&K/T&B/E&P award VP the engine's `computeVp` counts
            // (harbormaster +2, metropolis/defender/merchant, rivers Wealthiest+1/Poorest-2, caravans
            // between-camels, barbarianAttack captures, main-scenario deliveries, Cloth for Hexhaven's
            // floor(cloth/2), The Pirate Islands' captured-lair VP, The Wonders of Hexhaven's per-stage
            // VP, Explorers & Pirates' fish/spice/lair/gold mission VP + harbor-settlement VP) —
            // omitting any of this under-displayed a winner's total (B-38).
            const vp =
              baseVp +
              chitVp +
              clothVp +
              lairVp +
              wonderVp +
              extraVp +
              caravansVp +
              epFishVp +
              epSpiceVp +
              epLairVp +
              epGoldVp +
              epHarborVp;
            // The viewer's own VP cell carries the breakdown tooltip that used to live on the removed
            // VpWidget (B-44 "move VP elsewhere"); `otherVpCount` folds every non-base source.
            const otherVpCount =
              chitVp +
              clothVp +
              lairVp +
              wonderVp +
              extraVp +
              caravansVp +
              epFishVp +
              epSpiceVp +
              epLairVp +
              epGoldVp +
              epHarborVp;
            // Fishermen Old Boot (§TB2.5): the holder's own win THRESHOLD is +1 over the base target —
            // shown per-row so a viewer sees exactly how close the boot-holder is to THEIR target.
            const seatTarget = target + tbWinTargetBonus(view, p.seat);
            const seatTargetLabel = seatTarget >= LIMITLESS_CAP ? '∞' : String(seatTarget);
            const isWealthiest = wealthiestLeaders === 1 && maxCoins > 0 && (tbCoins[p.seat] ?? 0) === maxCoins;
            const isPoorest = maxCoins > 0 && (tbCoins[p.seat] ?? 0) === minCoins;
            const holdsOldBoot = oldBootHolder === p.seat;
            const vpBreakdown = ownVp
              ? (otherVpCount > 0
                  ? `${t('hud.vp.breakdown', { settlements: ownVp.settlements, cities: ownVp.cities, longestRoad: ownVp.longestRoad, largestArmy: ownVp.largestArmy, vpCards: ownVp.vpCards })} ${t('hud.vp.otherBreakdown', { count: otherVpCount })}`
                  : t('hud.vp.breakdown', { settlements: ownVp.settlements, cities: ownVp.cities, longestRoad: ownVp.longestRoad, largestArmy: ownVp.largestArmy, vpCards: ownVp.vpCards }))
              : null;
            const isTurn = view.turn.player === p.seat;
            const lr = view.awards.longestRoad.holder === p.seat;
            const la = view.awards.largestArmy.holder === p.seat;
            const hm = view.ext?.harbormaster?.holder === p.seat;
            const connected = isMe ? true : presence[p.seat];
            const disc = discardAmountFor(p.seat);
            return (
              <tr
                key={p.seat}
                data-testid={`scoreboard-seat-${p.seat}`}
                className={[isTurn ? 'bg-accent-gold/20' : '', isMe ? 'font-semibold text-ink' : 'text-ink-soft'].join(' ')}
              >
                <td className="px-1 py-1">
                  <span className="flex items-center gap-1">
                    <span aria-hidden="true" style={{ color: PLAYER_COLORS[p.seat] }}>{PLAYER_BADGES[p.seat]}</span>
                    <span className="max-w-[5.5rem] truncate">{seatName(p.seat)}</span>
                    {p.seat === pair1 ? <span className="text-accent-gold" aria-hidden="true">{PAIR1_GLYPH}</span> : null}
                    {p.seat === pair2 ? <span className="text-accent-gold" aria-hidden="true">{PAIR2_GLYPH}</span> : null}
                    {lr ? <span aria-hidden="true">{ROAD_GLYPH}</span> : null}
                    {la ? <span aria-hidden="true">{ARMY_GLYPH}</span> : null}
                    {hm ? <span aria-hidden="true" title={t('hud.awards.harbormaster')}>{HARBORMASTER_GLYPH}</span> : null}
                    {holdsOldBoot ? (
                      <span aria-hidden="true" title={t('tradersBarbarians:scoreboard.oldBoot')}>{OLD_BOOT_GLYPH}</span>
                    ) : null}
                    {isWealthiest ? (
                      <span aria-hidden="true" title={t('tradersBarbarians:scoreboard.wealthiest')}>{WEALTHIEST_GLYPH}</span>
                    ) : null}
                    {isPoorest ? (
                      <span aria-hidden="true" title={t('tradersBarbarians:scoreboard.poorest')}>{POOREST_GLYPH}</span>
                    ) : null}
                    {chitVp > 0 ? (
                      <span className="text-accent-gold tabular-nums" aria-hidden="true">{`${CHIT_GLYPH}+${chitVp}`}</span>
                    ) : null}
                    {clothVp > 0 ? (
                      <span
                        className="text-accent-gold tabular-nums"
                        aria-hidden="true"
                        title={t('hud.awards.cloth')}
                      >{`${CLOTH_GLYPH}+${clothVp}`}</span>
                    ) : null}
                    {lairVp > 0 ? (
                      <span
                        className="text-accent-gold tabular-nums"
                        aria-hidden="true"
                        title={t('hud.awards.lair')}
                      >{`${LAIR_GLYPH}+${lairVp}`}</span>
                    ) : null}
                    {wonderVp > 0 ? (
                      <span
                        className="text-accent-gold tabular-nums"
                        aria-hidden="true"
                        title={t('hud.awards.wonder')}
                      >{`${WONDER_GLYPH}+${wonderVp}`}</span>
                    ) : null}
                    {/* Explorers & Pirates (T-1155): each mission track shows whenever its OWN
                        mission is active — regardless of the seat's current tally — so a viewer
                        always sees which tracks are even in play (Land Ho! shows none, the full
                        campaign shows all). Harbor-settlement VP is the one exception: it is not
                        mission-gated (it scores in Land Ho! too), so it shows whenever the seat has
                        actually built one, mirroring the cloth/lair/wonder ">0" convention above. */}
                    {epFishOn ? (
                      <span
                        className="text-accent-gold tabular-nums"
                        aria-hidden="true"
                        title={t('hud.awards.epFish')}
                        data-testid={`scoreboard-ep-fish-${p.seat}`}
                      >{`${EP_FISH_GLYPH}+${epFishVp}`}</span>
                    ) : null}
                    {epSpiceOn ? (
                      <span
                        className="text-accent-gold tabular-nums"
                        aria-hidden="true"
                        title={t('hud.awards.epSpice', { level: epSpiceLevel })}
                        data-testid={`scoreboard-ep-spice-${p.seat}`}
                      >{`${EP_SPICE_GLYPH}+${epSpiceVp} L${epSpiceLevel}`}</span>
                    ) : null}
                    {epLairOn ? (
                      <span
                        className="text-accent-gold tabular-nums"
                        aria-hidden="true"
                        title={t('hud.awards.epLair')}
                        data-testid={`scoreboard-ep-lair-${p.seat}`}
                      >{`${EP_LAIR_GLYPH}+${epLairVp}`}</span>
                    ) : null}
                    {epGoldOn ? (
                      <span
                        className="text-accent-gold tabular-nums"
                        aria-hidden="true"
                        title={t('hud.awards.epGold')}
                        data-testid={`scoreboard-ep-gold-${p.seat}`}
                      >{`${EP_GOLD_GLYPH}+${epGoldVp}`}</span>
                    ) : null}
                    {epGame && epHarborVp > 0 ? (
                      <span
                        className="text-accent-gold tabular-nums"
                        aria-hidden="true"
                        title={t('hud.awards.epHarbor')}
                        data-testid={`scoreboard-ep-harbor-${p.seat}`}
                      >{`${EP_HARBOR_GLYPH}+${epHarborVp}`}</span>
                    ) : null}
                    {connected === false ? <span className="text-danger" aria-hidden="true">{DISCONNECT_GLYPH}</span> : null}
                    {disc ? <span className="text-danger tabular-nums">{`${DISCONNECT_GLYPH}${disc}`}</span> : null}
                  </span>
                </td>
                <td className={cell}>{cards}</td>
                <td className={cell}>{dev}</td>
                <td className={cell}>{p.playedKnights}</td>
                {ck ? (
                  <td className={cell} data-testid={`scoreboard-ck-${p.seat}`}>
                    <span className="inline-flex gap-0.5">
                      {IMPROVEMENT_TRACKS.map((track) => {
                        const level = ck.improvements[p.seat]?.[track] ?? 0;
                        return (
                          <span
                            key={track}
                            title={`${t(`citiesKnights:track.${track}`)}: ${level}/5`}
                            className="inline-flex h-4 w-4 items-center justify-center rounded-full border font-ui text-10 font-semibold leading-none text-ink"
                            style={{ borderColor: TRACK_COLOR[track], backgroundColor: level > 0 ? `${TRACK_COLOR[track]}33` : undefined }}
                          >
                            {level}
                          </span>
                        );
                      })}
                    </span>
                  </td>
                ) : null}
                <td className={`${cell} font-semibold`}>
                  {vpBreakdown ? (
                    <Tooltip content={vpBreakdown}>
                      <span tabIndex={0} data-testid="scoreboard-vp-self">{`${vp}/${seatTargetLabel}`}</span>
                    </Tooltip>
                  ) : (
                    `${vp}/${seatTargetLabel}`
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
