// Plural & interpolation correctness (T-306 §8). Builds a throwaway i18next instance straight from
// the shipped resource files — no `i18next-browser-languagedetector` (needs `window`/`navigator`,
// which don't exist under vitest's `node` environment; see the note atop `parity.test.ts` and the
// real, browser-only init in `src/i18n/index.ts`).
//
// Why this exists as more than the parity guard: `Intl.PluralRules('tr')` resolves to the same
// two CLDR categories as English (`one`, `other` — verified against this repo's Node 24 runtime,
// not assumed), so the parity guard's flat key-set check alone can't catch a Turkish string that
// is *shaped* right but grammatically wrong. Turkish nouns never inflect for plural after an
// explicit numeral ("3 koyun", not "3 koyunlar") — unlike English, which does for count nouns
// ("3 bricks") but not for the mass nouns Hexhaven also uses ("3 wool", not "3 wools"). These tests
// pin the actual rendered strings so that grammar can't regress silently.
import i18next from 'i18next';
import { beforeAll, describe, expect, it } from 'vitest';
import { HEX_PIECE_KIND_IDS } from '@hexhaven/engine';
import enCommon from './en/common.json';
import enLog from './en/log.json';
import trCommon from './tr/common.json';
import trLog from './tr/log.json';

describe('i18n plural & interpolation correctness (T-306 §8)', () => {
  let instance: ReturnType<typeof i18next.createInstance>;

  beforeAll(async () => {
    instance = i18next.createInstance();
    await instance.init({
      resources: {
        en: { log: enLog, common: enCommon },
        tr: { log: trLog, common: trCommon },
      },
      lng: 'en',
      fallbackLng: 'en',
      ns: ['log', 'common'],
      defaultNS: 'log',
      interpolation: { escapeValue: false },
    });
  });

  it('interpolates a player name into an English log line', async () => {
    await instance.changeLanguage('en');
    expect(instance.t('log:built.road', { name: 'Alex' })).toBe('Alex built a road.');
  });

  it('interpolates a player name into a Turkish log line without a broken suffix', async () => {
    await instance.changeLanguage('tr');
    // "Ali yol inşa etti." — {{name}} stays an unsuffixed nominative subject on purpose: Turkish
    // case/possessive suffixes vowel-harmonize with the word they attach to, which can't be
    // precomputed for an arbitrary player nickname. Every log string in tr/log.json is phrased so
    // dynamic tokens never take a suffix directly (see tr/log.json's `stolen`/`turnEnded` for the
    // "adlı oyuncu…" pattern used when a suffix would otherwise be unavoidable).
    expect(instance.t('log:built.road', { name: 'Ali' })).toBe('Ali yol inşa etti.');
  });

  it('handles two interpolated names in the same Turkish sentence (turnEnded)', async () => {
    await instance.changeLanguage('tr');
    expect(instance.t('log:turnEnded', { name: 'Ayşe', nextName: 'Mehmet' })).toBe(
      'Ayşe turunu bitirdi — sıra Mehmet adlı oyuncuda.',
    );
  });

  it('keeps the Turkish resource noun invariant across the plural boundary ("3 koyun")', async () => {
    await instance.changeLanguage('tr');
    expect(instance.t('log:resource.wool', { count: 1 })).toBe('1 koyun');
    expect(instance.t('log:resource.wool', { count: 3 })).toBe('3 koyun');
  });

  it('still pluralizes the English count noun where English grammar requires it', async () => {
    await instance.changeLanguage('en');
    expect(instance.t('log:resource.brick', { count: 1 })).toBe('1 brick');
    expect(instance.t('log:resource.brick', { count: 3 })).toBe('3 bricks');
  });

  it('never inflects a Turkish resource noun after a numeral, even one English pluralizes', async () => {
    await instance.changeLanguage('tr');
    expect(instance.t('log:resource.brick', { count: 1 })).toBe('1 tuğla');
    expect(instance.t('log:resource.brick', { count: 3 })).toBe('3 tuğla');
  });

  it('keeps English mass-noun resources invariant too (wool has no plural -s)', async () => {
    await instance.changeLanguage('en');
    expect(instance.t('log:resource.wool', { count: 1 })).toBe('1 wool');
    expect(instance.t('log:resource.wool', { count: 3 })).toBe('3 wool');
  });

  // B-47: every hex-piece kind must have a log line, in BOTH languages — the log formats
  // `hexPieceMoved.${kind}` for any moved piece, and only `wizard` existed (T-903 added the other 4
  // pieces but not their log keys), so moving a Trader/Banker/etc. printed a raw key.
  it('every hex-piece kind has a moved-log line in en + tr (no raw keys)', async () => {
    for (const lng of ['en', 'tr'] as const) {
      await instance.changeLanguage(lng);
      for (const kind of HEX_PIECE_KIND_IDS) {
        const line = instance.t(`log:hexPieceMoved.${kind}`, { name: 'Alex' });
        expect(line).not.toContain('hexPieceMoved'); // resolved to a real string, not the raw key
        expect(line).toContain('Alex');
      }
    }
  });

  it('switches language live on the same instance (what <LanguageSwitcher/> relies on)', async () => {
    await instance.changeLanguage('en');
    expect(instance.t('common:toast.dismiss')).toBe('Dismiss');
    await instance.changeLanguage('tr');
    expect(instance.t('common:toast.dismiss')).toBe('Kapat');
  });
});
