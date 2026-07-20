// Shared test-only i18n bootstrap for src/log/**'s test suite (mirrors hud/testI18n.ts's
// pattern). `GameLog`/`ChatPane` only ever read the `log` namespace (self-contained by design —
// see LogPanel.tsx's header comment), so this only needs to load that one resource file.
import i18next from 'i18next';
import { initReactI18next } from 'react-i18next';
import enLog from '../i18n/en/log.json';

let initialized: Promise<unknown> | null = null;

export function initTestI18n(): Promise<unknown> {
  initialized ??= i18next.use(initReactI18next).init({
    resources: { en: { log: enLog } },
    lng: 'en',
    fallbackLng: 'en',
    ns: ['log'],
    defaultNS: 'log',
    interpolation: { escapeValue: false },
  });
  return initialized;
}
