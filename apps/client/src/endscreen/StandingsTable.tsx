// StandingsTable (T-408 requirement 1): presentational final-standings table — one row per seat,
// winner highlighted, revealed VP cards called out per `standings.ts`'s `StandingRow` shape.
// Purely props-driven (like `robber/DiscardModal.tsx`) so `EndScreen.tsx` owns all the store
// wiring and this file stays trivially testable.
import { useTranslation } from 'react-i18next';
import type { Seat } from '@hexhaven/shared';
import { Badge } from '../ui';
import type { StandingRow } from './standings';

export interface StandingsTableProps {
  rows: StandingRow[];
  seatName: (seat: Seat) => string;
}

function vpCardsLabel(t: (key: string, opts?: Record<string, unknown>) => string, vpCards: number | null): string {
  if (vpCards === null) return t('standings.vpCardsHidden');
  if (vpCards === 0) return t('standings.vpCardsNone');
  return t('standings.vpCardsRevealed', { count: vpCards });
}

export function StandingsTable({ rows, seatName }: StandingsTableProps) {
  const { t } = useTranslation('endgame');

  return (
    <div className="overflow-x-auto" data-testid="standings-table">
      <h3 className="mb-2 font-display text-16 font-semibold text-ink">{t('standings.heading')}</h3>
      <table className="w-full min-w-[420px] border-collapse font-ui text-14 text-ink">
        <thead>
          <tr className="border-b border-panel-edge text-left text-12 uppercase tracking-wide text-ink-soft">
            <th className="py-1 pr-2 font-semibold">{t('standings.headers.player')}</th>
            <th className="px-2 text-center font-semibold">{t('standings.headers.settlements')}</th>
            <th className="px-2 text-center font-semibold">{t('standings.headers.cities')}</th>
            <th className="px-2 text-center font-semibold">{t('standings.headers.awards')}</th>
            <th className="px-2 text-center font-semibold">{t('standings.headers.vpCards')}</th>
            <th className="px-2 text-right font-semibold">{t('standings.headers.total')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.seat}
              data-testid={`standings-row-${row.seat}`}
              className={['border-b border-panel-edge/50', row.isWinner ? 'bg-accent-gold/20' : ''].join(' ')}
            >
              <td className="py-2 pr-2 font-semibold">
                <span className="inline-flex flex-wrap items-center gap-2">
                  <span>{seatName(row.seat)}</span>
                  {row.isWinner ? (
                    <Badge variant="gold" data-testid={`standings-winner-badge-${row.seat}`}>
                      {t('standings.winnerBadge')}
                    </Badge>
                  ) : null}
                  {row.isSelf ? (
                    <Badge data-testid={`standings-you-badge-${row.seat}`}>{t('standings.youBadge')}</Badge>
                  ) : null}
                </span>
              </td>
              <td className="px-2 text-center">{row.settlements}</td>
              <td className="px-2 text-center">{row.cities}</td>
              <td className="px-2 text-center">
                <div className="flex flex-wrap justify-center gap-1">
                  {row.longestRoad > 0 ? <Badge variant="gold">{t('game:hud.awards.longestRoad')}</Badge> : null}
                  {row.largestArmy > 0 ? <Badge variant="gold">{t('game:hud.awards.largestArmy')}</Badge> : null}
                </div>
              </td>
              <td className="px-2 text-center" data-testid={`standings-vpcards-${row.seat}`}>
                {vpCardsLabel(t, row.vpCards)}
              </td>
              <td className="px-2 text-right font-bold" data-testid={`standings-total-${row.seat}`}>
                {row.total}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
