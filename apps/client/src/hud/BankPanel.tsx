// BankPanel (T-402 requirement 3): per-resource remaining + dev deck count. Warn style at <=2
// remaining makes the R5.3 bank-shortage rule visible before a player is surprised by it.
import { useTranslation } from 'react-i18next';
import type { PlayerView } from '@hexhaven/engine';
import { Badge, Panel } from '../ui';
import { RESOURCE_GLYPH, RESOURCE_ORDER } from './constants';

/** R5.3: shortage resolves per resource type independently once the bank runs out — flagging at
 * <=2 gives players visible warning before a production roll can silently short them. */
const SHORTAGE_THRESHOLD = 2;

export interface BankPanelProps {
  bank: PlayerView['bank'];
  devDeckCount: number;
}

export function BankPanel({ bank, devDeckCount }: BankPanelProps) {
  const { t } = useTranslation('game');

  return (
    <Panel data-testid="bank-panel">
      <h3 className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('hud.bank.title')}</h3>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
        {RESOURCE_ORDER.map((resource) => {
          const count = bank[resource];
          const low = count <= SHORTAGE_THRESHOLD;
          return (
            // Playtest fix (readability): pair each bank line with its resource glyph (same
            // shared mapping as Hand/trade's ResourceIcon) — the glyph is decorative/aria-hidden,
            // the translated "N <resource>" text (kept on its own span, unchanged) remains the
            // accessible content and the one the shortage-warning `data-testid` targets.
            <span key={resource} className="inline-flex items-center gap-1">
              <span aria-hidden="true" className="text-14 leading-none">
                {RESOURCE_GLYPH[resource]}
              </span>
              <span
                data-testid={`bank-${resource}`}
                className={['font-ui text-12 font-semibold', low ? 'text-danger' : 'text-ink'].join(' ')}
              >
                {t(`log:resource.${resource}`, { count })}
              </span>
            </span>
          );
        })}
      </div>
      <div className="mt-2">
        <Badge>{t('hud.bank.devDeckCount', { count: devDeckCount })}</Badge>
      </div>
    </Panel>
  );
}
