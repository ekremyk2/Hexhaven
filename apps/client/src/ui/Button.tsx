// Button primitive (T-307 requirement 4). Three variants per docs/11: primary (terracotta fill,
// the "primary buttons" the doc calls out for --accent), subtle (outline, secondary actions), and
// danger (destructive actions — leave/discard/cancel). No literal copy lives here: callers pass
// already-translated `children` (t('...')), so this file never needs an i18n import itself.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { FOCUS_RING_CLASS, type ButtonSize } from './constants';

export type ButtonVariant = 'primary' | 'subtle' | 'danger';

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Stretch to fill the parent's width (flex/grid cell) instead of sizing to content. Lets a row
   * of buttons share equal widths in a grid without every caller re-deriving track sizing. */
  fullWidth?: boolean;
  children: ReactNode;
}

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-on-accent hover:brightness-110 active:brightness-95',
  subtle: 'bg-transparent text-ink border border-panel-edge hover:bg-panel-edge/40',
  // --danger-solid (not --danger): the fill stays dark enough for white in both themes; --danger
  // brightens in dark for readable danger *text*, which would be too light under a white label.
  danger: 'bg-danger-solid text-on-accent hover:brightness-110 active:brightness-95',
};

// T-506 requirement 2: every size is floored at the 44px touch minimum below `md:` and reverts to
// its exact original desktop height at `md:` (an inline `style` can't express a breakpoint). These
// MUST be STATIC literal class strings, not built by interpolation — Tailwind's JIT only generates a
// class it can see literally in source, so a runtime `min-h-[${px}px]` would silently produce no
// rule. Values mirror BUTTON_HIT_TARGET_PX (sm 32 / md 40 / lg 48) with a 44px mobile floor
// (MOBILE_MIN_HIT_TARGET_PX); `lg` already clears 44, so it needs no mobile override.
const MIN_HEIGHT_CLASS: Record<ButtonSize, string> = {
  sm: 'min-h-[44px] md:min-h-[32px]',
  md: 'min-h-[44px] md:min-h-[40px]',
  lg: 'min-h-[48px]',
};

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled,
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled}
      aria-disabled={disabled}
      className={[
        fullWidth ? 'flex w-full' : 'inline-flex',
        'items-center justify-center gap-2 rounded-button px-4 font-ui text-14 font-semibold',
        'transition-[filter,background-color] duration-150',
        MIN_HEIGHT_CLASS[size],
        VARIANT_CLASS[variant],
        FOCUS_RING_CLASS,
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
      ].join(' ')}
    >
      {children}
    </button>
  );
}
