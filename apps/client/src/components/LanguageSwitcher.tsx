// EN/TR segmented control (T-306 §6). Calls i18next directly so every mounted component using
// `useTranslation` re-renders immediately — no reload, no route change. Persistence to
// localStorage (`hexhaven.lang`) is handled by the `LanguageDetector` plugin registered in
// `src/i18n/index.ts`, which caches every `changeLanguage()` call automatically.
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../i18n';

export function LanguageSwitcher() {
  const { t, i18n } = useTranslation('common');
  const current = i18n.resolvedLanguage ?? i18n.language;

  return (
    <div
      role="group"
      aria-label={t('language.switcherLabel')}
      data-testid="language-switcher"
      className="inline-flex overflow-hidden rounded-md border border-gray-300"
    >
      {SUPPORTED_LANGUAGES.map((lng) => {
        const active = current === lng;
        return (
          <button
            key={lng}
            type="button"
            aria-pressed={active}
            aria-label={t(`language.${lng}Name`)}
            onClick={() => void i18n.changeLanguage(lng)}
            className={`px-2 py-1 text-xs font-semibold transition-colors ${
              active ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-100'
            }`}
          >
            {t(`language.${lng}`)}
          </button>
        );
      })}
    </div>
  );
}
