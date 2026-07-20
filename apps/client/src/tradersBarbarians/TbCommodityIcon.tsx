// TbCommodityIcon (T-1008): the 4 T&B commodities' badge, mirroring `board/CommodityIcon.tsx`'s
// `CommodityIcon` exactly (palette-colored ring + glyph + optional count, docs/11 §4 double-coding)
// but for `TBCommodity` (marble/glass/sand/tools) rather than C&K's paper/cloth/coin — kept as its
// own small component rather than widening `CommodityIcon`'s type, which every C&K caller relies on.
import { useTranslation } from 'react-i18next';
import type { TBCommodity } from '@hexhaven/shared';
import { TB_COMMODITY_COLOR, TB_COMMODITY_GLYPH } from '../board/tradersBarbariansPalette';

export interface TbCommodityIconProps {
  commodity: TBCommodity;
  /** Omit to render a bare glyph (e.g. a legend); present (including 0) to show a count badge. */
  count?: number;
}

export function TbCommodityIcon({ commodity, count }: TbCommodityIconProps) {
  const { t } = useTranslation('tradersBarbarians');
  return (
    <span
      data-testid={`tb-commodity-icon-${commodity}`}
      className="inline-flex items-center gap-1 rounded-full border-2 px-1.5 py-0.5 font-ui text-12 font-semibold text-ink"
      style={{ borderColor: TB_COMMODITY_COLOR[commodity] }}
      title={t(`main.commodity.${commodity}`)}
    >
      <span aria-hidden="true" className="text-14 leading-none">
        {TB_COMMODITY_GLYPH[commodity]}
      </span>
      {count != null ? <span data-testid={`tb-commodity-icon-${commodity}-count`}>{count}</span> : null}
    </span>
  );
}
