// IconButton primitive (visual-cohesion pass): a compact square control — glyph + a short label
// underneath — for dense action grids (C&K knight actions today: 7 buttons that used to be full-width
// `Button`s wrapping across several rows). Text-labeled (not icon-only) so the accessible name never
// depends on a hover tooltip and docs/11 §6 double-coding (never glyph/color alone) holds automatically.
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { FOCUS_RING_CLASS } from './constants';

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  icon: ReactNode;
  label: string;
  /** Selected/mode-active state (the button toggles a `uiMode`, mirrors `Button`'s primary look). */
  active?: boolean;
}

export function IconButton({ icon, label, active, disabled, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled}
      aria-disabled={disabled}
      aria-pressed={active}
      className={[
        'flex w-16 flex-col items-center justify-center gap-0.5 rounded-button border px-1 py-1.5',
        'transition-[filter,background-color,border-color] duration-150',
        active
          ? 'border-accent bg-accent text-on-accent'
          : 'border-panel-edge bg-panel text-ink hover:bg-panel-edge/40',
        disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer',
        FOCUS_RING_CLASS,
      ].join(' ')}
      style={{ minHeight: 44 }}
    >
      <span aria-hidden="true" className="text-16 leading-none">
        {icon}
      </span>
      <span className="text-center font-ui text-12 font-semibold leading-[1.05]">{label}</span>
    </button>
  );
}
