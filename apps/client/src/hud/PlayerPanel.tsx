// PlayerPanel (T-402 requirement 2): one per OPPONENT seat. Typed on `OtherPlayerView` — not the
// `PlayerViewEntry` union — so it is a compile error to reach for `.resources`/`.devCards` here;
// those fields simply don't exist on this type (docs/02 §6, redact.ts). That is the "assert via
// types" the task asks for: this file cannot render an opponent's card identities even by
// accident, because the data was never in scope, not merely hidden by a runtime check.
import { useTranslation } from 'react-i18next';
import type { OtherPlayerView, PlayerView } from '@hexhaven/engine';
import { Badge, PlayerChip } from '../ui';
import { DEV_CARD_BACK_GLYPH, KNIGHT_GLYPH, RESOURCE_BACK_GLYPH } from './constants';
import { computePublicVp } from './vp';

export interface PlayerPanelProps {
  entry: OtherPlayerView;
  /** Display name — lobby nickname (or a "Seat N" fallback), plain data, no i18n key needed. */
  name: string;
  /** Turn indicator (docs/11 §5 "Turn change" glow) — this seat is the one that must act. */
  active: boolean;
  /** Connection dot. `undefined` = not tracked (e.g. hot-seat) and renders as "online". */
  connected?: boolean;
  /** Present + >0 while `phase.kind === 'discard'` and this seat still owes a discard. */
  discardAmount?: number;
  awards: PlayerView['awards'];
}

export function PlayerPanel({ entry, name, active, connected, discardAmount, awards }: PlayerPanelProps) {
  const { t } = useTranslation('game');
  const vp = computePublicVp(entry, awards);
  const isLongestRoad = awards.longestRoad.holder === entry.seat;
  const isLargestArmy = awards.largestArmy.holder === entry.seat;
  const online = connected !== false;

  return (
    <div
      // "hexhaven-turn-glow" (docs/11 §5 "Turn change" crossfade) reused on the whole panel, not just
      // the chip pill, so the active seat reads clearly in the sidebar list — same transition-only
      // approach (no keyframe, no JS retrigger, collapses to instant under reduced motion).
      className={[
        'hexhaven-panel hexhaven-turn-glow flex flex-col gap-2 p-3',
        active ? 'ring-2 ring-accent-gold/60' : '',
      ].join(' ')}
      data-testid={`player-panel-${entry.seat}`}
    >
      <div className="flex items-center justify-between gap-2">
        <PlayerChip seat={entry.seat} name={name} active={active} />
        <span
          role="img"
          aria-label={t(online ? 'hud.connection.online' : 'hud.connection.offline')}
          className={['h-2.5 w-2.5 rounded-full', online ? 'bg-accent-gold' : 'bg-ink-soft'].join(' ')}
        />
      </div>

      <div className="flex flex-wrap items-center gap-3 font-ui text-12 text-ink">
        <span>
          <span aria-hidden="true">{RESOURCE_BACK_GLYPH} </span>
          {t('hud.player.resourceCount', { count: entry.resourceCount })}
        </span>
        <span>
          <span aria-hidden="true">{DEV_CARD_BACK_GLYPH} </span>
          {t('hud.player.devCardCount', { count: entry.devCardCount })}
        </span>
        <span>
          <span aria-hidden="true">{KNIGHT_GLYPH} </span>
          {t('hud.player.knightsPlayed', { count: entry.playedKnights })}
        </span>
        <Badge variant="gold">{t('hud.player.vp', { count: vp.total })}</Badge>
      </div>

      {isLongestRoad || isLargestArmy || discardAmount ? (
        <div className="flex flex-wrap gap-1">
          {/* "hexhaven-award-glow" (docs/11 §5 "Award transfer... gold trail") needs no JS diffing:
              this badge only exists in the DOM while its seat holds the award, so the very moment
              it's newly rendered (award just changed hands) the browser plays the keyframe once,
              same "animate on mount" trick InteractionLayer/motion.css's header note relies on. */}
          {isLongestRoad ? (
            <span className="hexhaven-award-glow motion-reduce:animate-none rounded-full">
              <Badge variant="gold">{t('hud.awards.longestRoad')}</Badge>
            </span>
          ) : null}
          {isLargestArmy ? (
            <span className="hexhaven-award-glow motion-reduce:animate-none rounded-full">
              <Badge variant="gold">{t('hud.awards.largestArmy')}</Badge>
            </span>
          ) : null}
          {discardAmount ? (
            <span className="animate-pulse motion-reduce:animate-none">
              <Badge variant="danger">{t('hud.player.discardPending', { count: discardAmount })}</Badge>
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
