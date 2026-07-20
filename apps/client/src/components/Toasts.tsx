// Toast surface (T-301 §6): renders the store's toast queue; `game.error` messages land here via
// the dispatcher (store/index.ts). Error payloads carry a code (data, not a localized string) —
// coded toasts are translated through the `errors` namespace (T-306 §4); a toast pushed without a
// code (none today, but the type allows it) falls back to its raw `message`.
// Restyled for T-307: markup/classes now live in ui/Toast.tsx (the design-system primitive); this
// component keeps owning the store wiring (queue, dismiss action) only.
import { useTranslation } from 'react-i18next';
import { useStore, useToasts } from '../store';
import { Toast } from '../ui';

// Codes whose SPECIFIC server message says something the generic translation can't (which field/limit
// is wrong) — for these, show the translated headline PLUS the detail (playtest: "should actually tell
// what's wrong with modifiers"). Every other coded toast shows only its localized `errors:<code>`.
const DETAIL_CODES = new Set(['MODIFIER_INVALID_CONFIG', 'MODIFIER_INCOMPATIBLE']);

export function Toasts() {
  const { t } = useTranslation(['common', 'errors']);
  const toasts = useToasts();
  const dismissToast = useStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    // Priority 2 UI overhaul: top-center, stacked, above the board/HUD/banners (z-30 for the
    // moving-robber/road-building banners) but below the dice-roll overlay (z-40) and modals
    // (z-50) — docs' stacking order "board < HUD < banners < toasts < dice overlay < modals".
    // `pointer-events-none` on the wrapper + `pointer-events-auto` per toast (ui/Toast.tsx) keeps
    // the board/HUD clickable through the gaps between stacked toasts.
    <div
      className="pointer-events-none fixed inset-x-0 top-4 z-30 flex flex-col items-center gap-2 px-4 sm:left-1/2 sm:right-auto sm:w-80 sm:-translate-x-1/2"
      data-testid="toasts"
    >
      {toasts.map((toast) => (
        <div key={toast.id} className="pointer-events-auto w-full sm:w-80">
          <Toast
            kind={toast.kind}
            message={
              toast.code
                ? DETAIL_CODES.has(toast.code) && toast.message
                  ? `${t(`errors:${toast.code}`)} ${toast.message}`
                  : t(`errors:${toast.code}`)
                : toast.message
            }
            prefix={toast.code ? t('common:toast.codeLabel', { code: toast.code }) : undefined}
            dismissLabel={t('common:toast.dismiss')}
            onDismiss={() => dismissToast(toast.id)}
          />
        </div>
      ))}
    </div>
  );
}
