// Cosmetic-theme switcher (T-907 PM wiring). Lives in the header next to `ThemeToggle` (light/
// dark) and `LanguageSwitcher` — same segmented-button shape, same "icon/glyph + i18n aria-label"
// discipline, styled to read on the always-dark header (docs/11 §1, mirrors ThemeToggle.tsx).
import { useTranslation } from 'react-i18next';
import { FOCUS_RING_CLASS } from '../ui/constants';
import { useHexhavenTheme } from './themeState';
import { THEME_IDS, themeDefinition } from './themes';

/** One glyph per shipped theme — decorative only (real names come from i18n), so the button row
 *  stays scannable at a glance the same way `ThemeToggle`'s sun/moon/circle glyphs do. */
const THEME_GLYPH: Record<(typeof THEME_IDS)[number], string> = {
  classic: '🎲',
  pirates: '🏴‍☠️',
  harvest: '🍂',
};

export function CosmeticThemeSwitcher() {
  const { t } = useTranslation('themes');
  const { themeId, setThemeId } = useHexhavenTheme();

  return (
    <div
      role="group"
      aria-label={t('switcherLabel')}
      data-testid="cosmetic-theme-switcher"
      className="inline-flex overflow-hidden rounded-md border border-panel-edge/40"
    >
      {THEME_IDS.map((id) => {
        const active = themeId === id;
        const name = t(themeDefinition(id).nameKey);
        return (
          <button
            key={id}
            type="button"
            aria-pressed={active}
            aria-label={name}
            title={name}
            data-testid={`cosmetic-theme-${id}`}
            onClick={() => setThemeId(id)}
            className={[
              'px-2 py-1 text-14 leading-none transition-colors',
              active ? 'bg-accent text-on-accent' : 'text-ink-ondark/80 hover:bg-ink-ondark/15',
              FOCUS_RING_CLASS,
            ].join(' ')}
          >
            <span aria-hidden="true">{THEME_GLYPH[id]}</span>
          </button>
        );
      })}
    </div>
  );
}
