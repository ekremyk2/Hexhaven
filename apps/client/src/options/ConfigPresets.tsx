// ConfigPresets (QoL): save several named game setups and load one with a click. Self-contained —
// owns the preset list + its localStorage persistence; the parent (Home) supplies the CURRENT config
// to save and an `onLoad` to apply a chosen preset. Complements the last-used auto-restore (B-50):
// that remembers your latest tweak; this keeps a small library of setups you switch between.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { RoomConfig } from '@hexhaven/shared';
import { Button, TextInput } from '../ui';
import {
  PRESET_NAME_MAX_LENGTH,
  readStoredPresets,
  removePreset,
  saveStoredPresets,
  upsertPreset,
  type NamedPreset,
} from '../routes/lobbyForms';

// A pictographic glyph, referenced via a const so the i18n-guard doesn't treat it as raw copy
// (same convention as hud/Scoreboard.tsx's glyphs) — the accessible name is the button's aria-label.
const DELETE_GLYPH = '×';

export interface ConfigPresetsProps {
  /** The current lobby config — what "Save" stores under the typed name. */
  value: RoomConfig;
  /** Apply a saved preset's config (Home threads this to its `updateRoomConfig`). */
  onLoad: (config: RoomConfig) => void;
}

export function ConfigPresets({ value, onLoad }: ConfigPresetsProps) {
  const { t } = useTranslation('lobby');
  const [presets, setPresets] = useState<NamedPreset[]>(() => readStoredPresets());
  const [name, setName] = useState('');

  const persist = (next: NamedPreset[]) => {
    setPresets(next);
    saveStoredPresets(next);
  };
  const save = () => {
    if (name.trim() === '') return;
    persist(upsertPreset(presets, name, value));
    setName('');
  };

  return (
    <div className="hexhaven-panel flex flex-col gap-2 p-3" data-testid="config-presets">
      <p className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('options.presets.heading')}</p>
      {presets.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {presets.map((p) => (
            <div key={p.name} className="flex items-center gap-1 rounded-card border border-panel-edge bg-panel px-2 py-1">
              <button
                type="button"
                data-testid={`preset-load-${p.name}`}
                className="font-ui text-12 font-medium text-ink hover:underline"
                onClick={() => onLoad(p.config)}
              >
                {p.name}
              </button>
              <button
                type="button"
                aria-label={t('options.presets.deleteAria', { name: p.name })}
                className="font-ui text-14 leading-none text-ink-soft hover:text-danger"
                onClick={() => persist(removePreset(presets, p.name))}
              >
                {DELETE_GLYPH}
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="font-ui text-12 text-ink-soft">{t('options.presets.empty')}</p>
      )}
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <TextInput
            label={t('options.presets.saveLabel')}
            value={name}
            maxLength={PRESET_NAME_MAX_LENGTH}
            placeholder={t('options.presets.savePlaceholder')}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <Button variant="subtle" disabled={name.trim() === ''} data-testid="preset-save" onClick={save}>
          {t('options.presets.saveButton')}
        </Button>
      </div>
    </div>
  );
}
