// Modal primitive (T-307 requirement 4): headless dialog + blurred overlay, Escape-to-close, and a
// manual focus trap (no focus-trap library — none allowed beyond the task's existing deps, docs/04
// §folder-structure). `title`/`children` are caller-resolved i18n strings; only the close button's
// label is owned here (it's identical everywhere Modal is used), from `common:ui.modal.close`.
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { usePrefersReducedMotion } from '../theme/motion';
import { Button } from './Button';

export interface ModalProps {
  open: boolean;
  onClose: () => void;
  /** Rendered as the dialog's accessible name (already translated by the caller). */
  title: string;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// docs/11 §5 "toast/modal enter-exit". `open` flipping straight to `false` would unmount this
// instantly (no time for an exit transition) — `EXIT_MS` is how long this component keeps
// rendering (in a visually-closing state) after that before it actually returns null. Kept short
// and only used when motion is fine; reduced motion collapses straight to instant unmount.
const EXIT_MS = 180;

export function Modal({ open, onClose, title, children }: ModalProps) {
  const { t } = useTranslation('common');
  const reducedMotion = usePrefersReducedMotion();
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const [phase, setPhase] = useState<'closed' | 'open' | 'closing'>(open ? 'open' : 'closed');

  // Bug fix (scroll-position reset on every re-render): callers typically pass an inline
  // `onClose={() => ...}` (e.g. `ModifiersDialog`'s host toggling a modifier), which is a NEW
  // function identity on every parent re-render. Keeping it in a ref (read by the effect below via
  // `onCloseRef.current`) means the effect's own dependency array can key on `open` alone — it no
  // longer needs to include `onClose`, so it doesn't re-run (and re-steal focus onto the dialog's
  // first focusable element, which visibly resets the scrollable dialog back to the top) on every
  // unrelated content update while the dialog stays open.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  // Visual-only close delay — entirely separate from the focus-trap effect below (which still
  // keys strictly off the real `open` prop, not this derived `phase`).
  useEffect(() => {
    if (open) {
      setPhase('open');
      return undefined;
    }
    setPhase((p) => (p === 'closed' ? 'closed' : 'closing'));
    if (reducedMotion) {
      setPhase('closed');
      return undefined;
    }
    const timer = setTimeout(() => setPhase('closed'), EXIT_MS);
    return () => clearTimeout(timer);
  }, [open, reducedMotion]);

  useEffect(() => {
    if (!open) return undefined;

    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusables = dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)) : [];
    (focusables[0] ?? dialog)?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialog) return;
      const nodes = Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (nodes.length === 0) return;
      const first = nodes[0]!;
      const last = nodes[nodes.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      previouslyFocused.current?.focus();
    };
    // `open` alone: re-running this effect on every `onClose` identity change would re-run the
    // initial-focus logic above too (see the `onCloseRef` comment near this component's top),
    // stealing focus back onto the dialog's first element and visibly resetting scroll — the fix
    // for the "toggling a modifier resets the popup's scroll position" bug.
  }, [open]);

  if (phase === 'closed') return null;

  const closing = phase === 'closing';

  return (
    <div
      // Priority 4 (mobile): below 768px every Modal (discard/gold/steal/trade/robber/card
      // dialogs, Modifiers, expansion pickers) becomes a full-width BOTTOM SHEET — the dialog
      // docks to the bottom edge (`items-end`) instead of floating centered, so it's reachable
      // one-thumb and never requires pinch-zooming past the notch/keyboard. `md:` reverts to the
      // original centered dialog on tablet/desktop.
      className={[
        'fixed inset-0 z-50 flex items-end justify-center bg-ink/40 backdrop-blur-sm md:items-center',
        reducedMotion ? '' : 'hexhaven-backdrop-enter',
      ]
        .join(' ')
        .trim()}
      style={closing ? { pointerEvents: 'none' } : undefined}
      onMouseDown={(event) => {
        if (!closing && event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="hexhaven-modal-title"
        tabIndex={-1}
        className={[
          // Bug fix: a single bounded vertical scroll region (max-height + overflow-y-auto) with
          // horizontal overflow hard-disabled — any caller content wider than the dialog (e.g. the
          // customConstants cost grid) must wrap/shrink to fit rather than growing a second,
          // horizontal scrollbar (docs/11 §6 "no layout thrash"/scan-ability).
          // Mobile bottom sheet: full width, only the top corners rounded, a bit more vertical
          // room (90vh) since there's no side margin to also reclaim; `md:` restores the original
          // centered card (max-w-md, all corners rounded, 85vh).
          'hexhaven-panel max-h-[90vh] w-full overflow-y-auto overflow-x-hidden rounded-b-none p-6 focus:outline-none',
          'md:max-h-[85vh] md:max-w-md md:rounded-b-panel',
          reducedMotion ? '' : closing ? 'hexhaven-modal-exit' : 'hexhaven-modal-enter',
        ].join(' ')}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <h2 id="hexhaven-modal-title" className="font-display text-20 font-semibold text-ink">
            {title}
          </h2>
          {/* `size="lg"` on mobile-first for a comfortably tappable close target on a bottom
              sheet; `md:` drops back to the compact `sm` corner button on desktop. Button doesn't
              take a `className` prop (ui/Button.tsx omits it), so the responsive swap wraps two
              differently-sized buttons in visibility spans rather than restyling one. */}
          <span className="md:hidden">
            <Button variant="subtle" size="lg" aria-label={t('ui.modal.close')} onClick={onClose}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" className="fill-none stroke-current">
                <path d="M2 2 L14 14 M14 2 L2 14" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </Button>
          </span>
          <span className="hidden md:inline-flex">
            <Button variant="subtle" size="sm" aria-label={t('ui.modal.close')} onClick={onClose}>
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" className="fill-none stroke-current">
                <path d="M2 2 L14 14 M14 2 L2 14" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </Button>
          </span>
        </div>
        {children}
      </div>
    </div>
  );
}
