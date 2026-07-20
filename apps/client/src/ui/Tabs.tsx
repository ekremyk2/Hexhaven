// Tabs primitive (visual-cohesion pass): panel-content navigation — distinct from `SegmentedControl`
// (a `radiogroup` for mutually-exclusive OPTIONS, e.g. a language switcher) in both semantics
// (`tablist`/`tab`, not `radiogroup`/`radio`) and look (an underline indicator on a full-width strip,
// not a pill inside a bordered pill). Introduced so every multi-section panel (the consolidated C&K
// action panel, the sidebar log/chat split) shares one tab recipe instead of each hand-rolling its
// own `role="tablist"` div (`log/LogPanel.tsx` predates this and keeps its own copy — same markup
// shape, left alone to avoid an unrelated diff in a file this pass doesn't otherwise touch).
import { FOCUS_RING_CLASS } from './constants';

export interface TabDef {
  id: string;
  label: string;
  /** Small trailing count/status badge content (e.g. a hand-size count). */
  badge?: string | number;
}

export interface TabsProps {
  tabs: TabDef[];
  activeId: string;
  onChange: (id: string) => void;
  /** Accessible name for the tablist (already translated by the caller). */
  ariaLabel: string;
  className?: string;
}

export function Tabs({ tabs, activeId, onChange, ariaLabel, className }: TabsProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={['flex gap-1 overflow-x-auto border-b border-panel-edge', className].filter(Boolean).join(' ')}
    >
      {tabs.map((tab) => {
        const selected = tab.id === activeId;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={[
              // T-506 requirement 2: floored at 44px below `md:` (touch minimum); `md:` reverts to
              // the original 40px desktop height — see `ui/Button.tsx`'s `minHeightClass` for the
              // same pattern (inline `style` can't express a breakpoint).
              'flex shrink-0 items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 font-ui text-14 font-semibold transition-colors',
              'min-h-[44px] md:min-h-[40px]',
              selected ? 'border-accent text-ink' : 'border-transparent text-ink-soft hover:text-ink',
              FOCUS_RING_CLASS,
            ].join(' ')}
          >
            {tab.label}
            {tab.badge != null ? (
              <span
                className={[
                  'inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 font-ui text-12 font-semibold',
                  selected ? 'bg-accent text-on-accent' : 'bg-panel-edge text-ink-soft',
                ].join(' ')}
              >
                {tab.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
