// SettingsMenu: a single gear button in the header that opens a "Settings" popup consolidating the
// three display switchers (app theme, board theme, language) that used to sit inline in the header
// (user request: compact the top bar into a menu). The controls are rebuilt here as labeled
// SegmentedControls (panel-appropriate styling) driven by the SAME hooks the old inline switchers
// used — useTheme (light/dark/system), useHexhavenTheme (cosmetic board theme), and i18next — so
// behavior is identical; only the presentation moved.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, SegmentedControl } from '../ui';
import { FOCUS_RING_CLASS } from '../ui/constants';
import { THEME_CHOICES, useTheme, type ThemeChoice } from '../theme/theme';
import { useHexhavenTheme } from '../themes/themeState';
import { THEME_IDS, themeDefinition } from '../themes/themes';
import { SUPPORTED_LANGUAGES } from '../i18n';

/** Decorative gear glyph (referenced, not inlined, so the i18n raw-text guard treats it as an icon
 *  rather than translatable copy — same pattern as ThemeToggle's glyph map). */
const GEAR_GLYPH = '⚙';

export function SettingsMenu() {
  const { t, i18n } = useTranslation(['common', 'themes']);
  const [open, setOpen] = useState(false);
  const { choice, setChoice } = useTheme();
  const { themeId, setThemeId } = useHexhavenTheme();
  const currentLang = i18n.resolvedLanguage ?? i18n.language;

  return (
    <>
      <button
        type="button"
        aria-haspopup="dialog"
        aria-label={t('common:settings.title')}
        title={t('common:settings.title')}
        data-testid="settings-open-button"
        onClick={() => setOpen(true)}
        className={[
          'inline-flex h-8 w-8 items-center justify-center rounded-md text-16 text-ink-ondark/80 transition-colors hover:bg-ink-ondark/15',
          FOCUS_RING_CLASS,
        ].join(' ')}
      >
        <span aria-hidden="true">{GEAR_GLYPH}</span>
      </button>

      <Modal open={open} onClose={() => setOpen(false)} title={t('common:settings.title')}>
        <div className="flex flex-col gap-4" data-testid="settings-menu">
          <div>
            <p className="mb-1 font-ui text-14 font-medium text-ink">{t('common:theme.switcherLabel')}</p>
            <SegmentedControl
              ariaLabel={t('common:theme.switcherLabel')}
              value={choice}
              onChange={(v) => setChoice(v as ThemeChoice)}
              options={THEME_CHOICES.map((c) => ({ value: c, label: t(`common:theme.${c}`) }))}
            />
          </div>

          <div>
            <p className="mb-1 font-ui text-14 font-medium text-ink">{t('themes:switcherLabel')}</p>
            <SegmentedControl
              ariaLabel={t('themes:switcherLabel')}
              value={themeId}
              onChange={(v) => setThemeId(v as (typeof THEME_IDS)[number])}
              options={THEME_IDS.map((id) => ({ value: id, label: t(themeDefinition(id).nameKey, { ns: 'themes' }) }))}
            />
          </div>

          <div>
            <p className="mb-1 font-ui text-14 font-medium text-ink">{t('common:language.switcherLabel')}</p>
            <SegmentedControl
              ariaLabel={t('common:language.switcherLabel')}
              value={currentLang}
              onChange={(v) => void i18n.changeLanguage(v)}
              options={SUPPORTED_LANGUAGES.map((lng) => ({ value: lng, label: t(`common:language.${lng}Name`) }))}
            />
          </div>
        </div>
      </Modal>
    </>
  );
}
