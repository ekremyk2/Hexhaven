// Light / Dark / System theme toggle (T-505 dark mode). Lives in the header next to the language
// switcher. Icon-only buttons (language-neutral glyphs) with i18n'd aria-labels + group label, so
// no visible copy needs translating but AT users still get named controls (en + tr). Selecting a
// choice persists it and flips `data-theme` on <html> via useTheme() — that one attribute reskins
// every surface through the design tokens (theme/tokens.dark.css).
//
// Styled to read on the always-dark header in BOTH themes: cream `--ink-ondark` glyphs (stable, so
// legible on the dark ocean bar regardless of theme), the active choice filled with `--accent`.
import { useTranslation } from 'react-i18next';
import { FOCUS_RING_CLASS } from '../ui/constants';
import { THEME_CHOICES, useTheme, type ThemeChoice } from '../theme/theme';

const CHOICE_GLYPH: Record<ThemeChoice, string> = {
  light: '☀',
  dark: '☾',
  system: '◐',
};

export function ThemeToggle() {
  const { t } = useTranslation('common');
  const { choice, setChoice } = useTheme();

  return (
    <div
      role="group"
      aria-label={t('theme.switcherLabel')}
      data-testid="theme-toggle"
      className="inline-flex overflow-hidden rounded-md border border-panel-edge/40"
    >
      {THEME_CHOICES.map((option) => {
        const active = choice === option;
        return (
          <button
            key={option}
            type="button"
            aria-pressed={active}
            aria-label={t(`theme.${option}`)}
            title={t(`theme.${option}`)}
            onClick={() => setChoice(option)}
            className={[
              'px-2 py-1 text-14 leading-none transition-colors',
              active ? 'bg-accent text-on-accent' : 'text-ink-ondark/80 hover:bg-ink-ondark/15',
              FOCUS_RING_CLASS,
            ].join(' ')}
          >
            <span aria-hidden="true">{CHOICE_GLYPH[option]}</span>
          </button>
        );
      })}
    </div>
  );
}
