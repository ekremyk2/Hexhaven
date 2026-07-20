// BoardPresetPicker (T-607): the generic, registry-driven board picker. Given the list of
// `BoardPreset`s for a mode, it renders a `radiogroup` where CONFIRMED presets (`available`) are
// selectable and CATALOG-ONLY ones render disabled with a "coming soon" badge — the same honesty
// pattern the OptionsPanel uses for unshipped expansions. It is deliberately generic over
// `BoardPreset` and stateless: T-705's Seafarers picker is this exact component fed
// `boardPresetsForMode('seafarers')` instead of base/fiveSix.
//
// Copy comes from the presets' namespace-qualified i18n keys (`lobby:…`), so the picker works
// unchanged inside the `game`-namespace hot-seat page as well as the `lobby` OptionsPanel.
import { useTranslation } from 'react-i18next';
import type { BoardPreset } from '@hexhaven/shared';
import { Badge } from '../ui';
import { FOCUS_RING_CLASS } from '../ui/constants';

export interface BoardPresetPickerProps {
  /** Presets to offer, already filtered to the active mode (`boardPresetsForMode`). */
  presets: readonly BoardPreset[];
  /** The selected preset id (`config.board`). */
  value: string;
  /** Fired only for selectable (`available`) presets, with the chosen preset id. */
  onChange: (id: string) => void;
  /** Accessible name for the group (already translated by the caller). */
  ariaLabel: string;
}

export function BoardPresetPicker({ presets, value, onChange, ariaLabel }: BoardPresetPickerProps) {
  const { t } = useTranslation(['lobby', 'common']);
  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      data-testid="board-preset-picker"
      className="flex flex-col gap-2"
    >
      {presets.map((preset) => {
        const selected = preset.id === value;
        const disabled = !preset.available;
        return (
          <button
            key={`${preset.mode}.${preset.id}`}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-disabled={disabled}
            disabled={disabled}
            onClick={() => {
              if (!disabled) onChange(preset.id);
            }}
            className={[
              'flex flex-col items-start gap-0.5 rounded-card border p-2 text-left transition-colors',
              selected
                ? 'border-accent bg-accent/10'
                : 'border-panel-edge bg-panel hover:bg-panel-edge/40',
              disabled ? 'cursor-not-allowed opacity-50' : '',
              FOCUS_RING_CLASS,
            ].join(' ')}
          >
            <span className="flex items-center gap-2 font-ui text-14 font-semibold text-ink">
              <span>{t(preset.labelKey)}</span>
              {disabled ? <Badge variant="default">{t('lobby:options.comingSoonBadge')}</Badge> : null}
            </span>
            <span className="font-ui text-12 text-ink-soft">{t(preset.descriptionKey)}</span>
          </button>
        );
      })}
    </div>
  );
}
