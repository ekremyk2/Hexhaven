// CostCard (T-403 requirement 2): the classic building-costs reference card. `CostCard` itself is
// purely presentational (data in, markup out); `CostCardPopover` wraps it with the open/close +
// floating-position behavior so `ActionBar.tsx` can drop it in without any popover state of its own.
// Each resource in each item's cost is colored per have/need against the viewer's current hand
// (R7.1's cost table) — the same "flag it before it surprises you" idea `BankPanel`'s shortage
// coloring uses. Costs render as the resource GLYPH + number (playtest: names were verbose and made
// the card wide enough to overflow), reusing the shared `RESOURCE_GLYPH` mapping from the HUD.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { OwnPlayerView } from '@hexhaven/engine';
import { COSTS } from '@hexhaven/shared';
import { Card } from '../ui';
import { RESOURCE_GLYPH, RESOURCE_ORDER } from '../hud/constants';

export interface CostCardProps {
  own: OwnPlayerView;
}

const ITEMS = ['road', 'settlement', 'city', 'devCard'] as const;

// Thin space between glyph and number — a plain constant (punctuation, not copy), kept out of the
// span's text so the cell stays a single text node (the test's `cost-<item>-<res>` matcher and the
// i18n-guard both only care that it's an `{EXPRESSION}` child, not literal JSX text).
const GLYPH_GAP = ' ';

export function CostCard({ own }: CostCardProps) {
  const { t } = useTranslation('game');

  return (
    <Card data-testid="cost-card">
      <h3 className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('controls.costCard.title')}</h3>
      <ul className="mt-2 flex flex-col gap-1.5">
        {ITEMS.map((item) => {
          const cost = COSTS[item];
          return (
            <li key={item} className="flex items-center justify-between gap-4 font-ui text-12">
              <span className="font-semibold text-ink">{t(`controls.costCard.items.${item}`)}</span>
              <span className="flex gap-2">
                {RESOURCE_ORDER.filter((r) => (cost[r] ?? 0) > 0).map((r) => {
                  const need = cost[r] ?? 0;
                  const have = own.resources[r];
                  const short = have < need;
                  return (
                    <span
                      key={r}
                      data-testid={`cost-${item}-${r}`}
                      title={t(`log:resource.${r}`, { count: need })}
                      className={short ? 'font-semibold text-danger' : 'font-semibold text-ink'}
                    >
                      {`${RESOURCE_GLYPH[r]}${GLYPH_GAP}${need}`}
                    </span>
                  );
                })}
              </span>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export interface CostCardPopoverProps {
  own: OwnPlayerView;
  /** Trigger copy (already-translated) — the "Building costs" toggle label. */
  triggerLabel: string;
}

/** Building-costs toggle + floating card. The card renders through a PORTAL to `document.body` at a
 * fixed, viewport-relative position anchored to the trigger's top-right and opening up-left — the
 * ActionBar lives inside Game.tsx's fit-to-viewport `overflow-hidden` shell, so an in-flow `absolute`
 * popover was clipped at the panel edge (user-reported: "fix where it is"). Same portal rationale as
 * `Tooltip`. Closes on outside click or Escape. */
export function CostCardPopover({ own, triggerLabel }: CostCardPopoverProps) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ right: number; bottom: number; maxWidth: number }>({ right: 0, bottom: 0, maxWidth: 320 });

  const measure = useCallback(() => {
    const el = triggerRef.current;
    if (!el || typeof window === 'undefined') return;
    const r = el.getBoundingClientRect();
    setPos({
      right: Math.max(8, window.innerWidth - r.right),
      bottom: window.innerHeight - r.top + 8,
      // never let the card cross the left viewport edge (this was the clipped-text bug)
      maxWidth: Math.min(320, r.right - 8),
    });
  }, []);

  useLayoutEffect(() => {
    if (open) measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return undefined;
    function onDown(e: MouseEvent) {
      const target = e.target as Node;
      if (triggerRef.current?.contains(target) || cardRef.current?.contains(target)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', measure);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', measure);
    };
  }, [open, measure]);

  const canPortal = typeof document !== 'undefined';

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="cost-card-trigger"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="cursor-pointer select-none font-ui text-12 font-semibold text-ink-soft hover:text-ink"
      >
        {triggerLabel}
      </button>
      {open && canPortal
        ? createPortal(
            <div
              ref={cardRef}
              data-testid="cost-card-popover"
              style={{ position: 'fixed', right: pos.right, bottom: pos.bottom, maxWidth: pos.maxWidth, zIndex: 1000 }}
            >
              <CostCard own={own} />
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
