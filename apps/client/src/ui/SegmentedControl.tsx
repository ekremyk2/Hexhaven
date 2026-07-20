// SegmentedControl primitive (T-307 requirement 4): a `radiogroup` of mutually-exclusive options
// (e.g. language switcher, resource-count stepper). `options[].label` is caller-resolved i18n copy.
//
// T-401 extension: per-option `disabled` (player-count 5/6 stay disabled until the fiveSix toggle
// is on) and a whole-group `disabled` (an entire expansion on/off control while the expansion is
// unshipped, D-026's "coming soon" toggles). Both are optional and additive — every pre-existing
// caller (styleguide, language switcher) is unaffected.
import { FOCUS_RING_CLASS } from './constants';

export interface SegmentedControlOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SegmentedControlProps {
  options: SegmentedControlOption[];
  value: string;
  onChange: (value: string) => void;
  /** Accessible name for the group (already translated by the caller). */
  ariaLabel: string;
  /** Disables every option in the group (e.g. an unshipped expansion's on/off toggle). */
  disabled?: boolean;
}

export function SegmentedControl({ options, value, onChange, ariaLabel, disabled }: SegmentedControlProps) {
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      aria-disabled={disabled ? true : undefined}
      className="inline-flex gap-1 rounded-button border border-panel-edge bg-panel p-1"
    >
      {options.map((option) => {
        const selected = option.value === value;
        const optionDisabled = Boolean(disabled) || Boolean(option.disabled);
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={optionDisabled}
            disabled={optionDisabled}
            onClick={() => {
              if (!optionDisabled) onChange(option.value);
            }}
            className={[
              // T-506 requirement 2: floored at 44px below `md:` (touch minimum, e.g. the lobby's
              // player-count/expansion radios); `md:` reverts to the original 32px desktop height.
              'min-h-[44px] md:min-h-[32px] rounded-button px-3 font-ui text-14 font-medium transition-colors',
              selected ? 'bg-accent text-on-accent' : 'bg-transparent text-ink hover:bg-panel-edge/40',
              optionDisabled ? 'cursor-not-allowed opacity-50' : '',
              FOCUS_RING_CLASS,
            ].join(' ')}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
