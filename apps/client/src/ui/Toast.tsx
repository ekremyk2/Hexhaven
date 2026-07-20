// Toast primitive (T-307 requirement 4: "a Toast restyle"). Presentational only — `message` and
// `dismissLabel` are caller-resolved i18n copy; components/Toasts.tsx (T-301) owns the store
// wiring (queue, dismiss action) and renders one of these per queued toast.
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { usePrefersReducedMotion } from '../theme/motion';
import { FOCUS_RING_CLASS } from './constants';

/** How long a toast stays before auto-dismissing (docs/11 §5 toasts are transient). */
const AUTO_DISMISS_MS = 5000;

export type ToastKind = 'info' | 'error';

export interface ToastProps {
  kind: ToastKind;
  message: string;
  dismissLabel: string;
  onDismiss: () => void;
  /** Optional leading badge/code slot (e.g. the coded-error `[CODE]` prefix). */
  prefix?: ReactNode;
}

// docs/11 §5 "toast/modal enter-exit". Enter just needs the class (a toast mounting fresh is
// exactly when the browser plays a CSS animation — same "animate on mount" approach as the
// placement pop/award glow). Exit needs a beat of visible-but-leaving time before the caller
// actually drops it from the queue, so `onDismiss` (which removes this Toast from the list) is
// deferred until the exit keyframe finishes — `onAnimationEnd` fires that, no fixed setTimeout
// guessing the duration.
export function Toast({ kind, message, dismissLabel, onDismiss, prefix }: ToastProps) {
  const reducedMotion = usePrefersReducedMotion();
  const [dismissing, setDismissing] = useState(false);

  function requestDismiss() {
    if (dismissing) return;
    if (reducedMotion) {
      onDismiss();
      return;
    }
    setDismissing(true);
  }

  // Auto-dismiss after a few seconds so toasts don't pile up (they also dismiss on click / via the
  // button). Runs once on mount; the timer is cleared if the toast is dismissed or unmounts first.
  useEffect(() => {
    const timer = setTimeout(requestDismiss, AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      onAnimationEnd={dismissing ? onDismiss : undefined}
      onClick={requestDismiss}
      title={dismissLabel}
      className={[
        'hexhaven-panel flex cursor-pointer items-start gap-3 border-l-4 p-3 font-ui text-14 text-ink',
        kind === 'error' ? 'border-l-danger' : 'border-l-accent',
        reducedMotion ? '' : dismissing ? 'hexhaven-toast-exit' : 'hexhaven-toast-enter',
      ].join(' ')}
    >
      <div className="flex-1">
        {prefix ? <span className="mr-2 font-ui text-12 text-ink-soft">{prefix}</span> : null}
        <span>{message}</span>
      </div>
      <button
        type="button"
        onClick={requestDismiss}
        className={[
          'shrink-0 rounded-button px-2 py-1 font-ui text-12 font-medium text-ink-soft underline underline-offset-2 hover:text-ink',
          FOCUS_RING_CLASS,
        ].join(' ')}
      >
        {dismissLabel}
      </button>
    </div>
  );
}
