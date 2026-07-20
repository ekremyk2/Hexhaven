// TextInput primitive (T-307 requirement 4): label + input + an inline-error slot. `label` and
// `error` are strings the caller already resolved via t('...') — this component only lays them
// out and wires the ARIA relationships (aria-invalid/aria-describedby), it never invents copy.
import { useId } from 'react';
import type { InputHTMLAttributes } from 'react';
import { FOCUS_RING_CLASS } from './constants';

export interface TextInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'className' | 'id'> {
  label: string;
  error?: string;
}

export function TextInput({ label, error, ...rest }: TextInputProps) {
  const inputId = useId();
  const errorId = useId();

  return (
    // `min-w-0` lets this sit inside a CSS grid/flex row (e.g. the customConstants cost grid,
    // ModifiersDialog.tsx) without its content forcing the track wider than the row — a plain
    // `<input>`'s intrinsic width otherwise resists shrinking and blows out the container
    // (bug fix: horizontal-overflow scrollbar in the Modifiers popup).
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={inputId} className="font-ui text-14 font-medium text-ink">
        {label}
      </label>
      <input
        {...rest}
        id={inputId}
        aria-invalid={Boolean(error)}
        aria-describedby={error ? errorId : undefined}
        className={[
          'w-full min-w-0 rounded-button border bg-field px-3 py-2 font-ui text-16 text-ink',
          error ? 'border-danger' : 'border-panel-edge',
          FOCUS_RING_CLASS,
        ].join(' ')}
      />
      {error ? (
        <p id={errorId} role="alert" className="font-ui text-12 text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
