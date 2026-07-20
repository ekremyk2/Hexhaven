// Badge primitive (T-307 requirement 4): small pill for counts/status (dev-card counts, "host",
// award callouts). `children` is caller-resolved i18n copy or a plain number.
import type { HTMLAttributes, ReactNode } from 'react';

export type BadgeVariant = 'default' | 'gold' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  children: ReactNode;
}

const VARIANT_CLASS: Record<BadgeVariant, string> = {
  default: 'bg-panel-edge text-ink',
  // The gold fill and the danger fill are theme-independent brand colors (tokens.dark.css keeps
  // them), so their labels use the *stable* inks: --ink-onlight (dark) reads on gold in both
  // themes, and --danger-solid is the dark danger fill under white (--danger itself brightens in
  // dark for danger *text*, which would fail as a fill under white).
  gold: 'bg-accent-gold text-ink-onlight',
  danger: 'bg-danger-solid text-on-accent',
};

export function Badge({ variant = 'default', children, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={[
        'inline-flex items-center rounded-full px-2 py-0.5 font-ui text-12 font-semibold',
        VARIANT_CLASS[variant],
      ].join(' ')}
    >
      {children}
    </span>
  );
}
