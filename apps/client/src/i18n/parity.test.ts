// Key-parity guard (T-306 §3 — the "RK-14 guard"): every locale under `src/i18n/<lang>/*.json`
// must define exactly the same set of keys, and none of them may be empty. Add a string to one
// language without adding it to the other and this test fails, listing every offending key.
//
// This walks the JSON on disk rather than going through `src/i18n/index.ts` on purpose: that
// module registers `i18next-browser-languagedetector`, which reaches for `window`/`navigator` the
// moment it's imported — fine in the Vite/browser bundle, fatal under vitest's `node` environment
// (see vitest.config.ts). Reading the files directly also means this guard exercises exactly what
// ships, independent of how the runtime happens to wire things up.
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const I18N_DIR = dirname(fileURLToPath(import.meta.url));

/** A parsed resource file: string leaves, arbitrarily nested under object keys (mirrors the
 * `en`/`tr` JSON shape — see e.g. `en/log.json`'s `setupPlaced.settlement`). */
type ResourceTree = { [key: string]: ResourceTree | string };

function listLanguages(): string[] {
  return readdirSync(I18N_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

function listNamespaces(lang: string): string[] {
  return readdirSync(join(I18N_DIR, lang))
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length))
    .sort();
}

function readNamespace(lang: string, ns: string): ResourceTree {
  const raw = readFileSync(join(I18N_DIR, lang, `${ns}.json`), 'utf8');
  return JSON.parse(raw) as ResourceTree;
}

/** Flattens `{ a: { b: "x" } }` into `Map { "a.b" => "x" }` — dotted paths match the i18next
 * `keySeparator` convention the app uses, so a failure message reads as a real, usable `t()` key. */
function flatten(tree: ResourceTree, prefix = ''): Map<string, string> {
  const out = new Map<string, string>();
  for (const [key, value] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') {
      out.set(path, value);
    } else if (value && typeof value === 'object' && !Array.isArray(value)) {
      for (const [childPath, childValue] of flatten(value, path)) out.set(childPath, childValue);
    } else {
      throw new Error(`BUG: ${path} is neither a string nor an object leaf`);
    }
  }
  return out;
}

const languages = listLanguages();

describe('i18n key parity (RK-14 guard)', () => {
  it('ships at least the en/tr languages this task adds', () => {
    expect(languages).toEqual(expect.arrayContaining(['en', 'tr']));
  });

  it('every language directory offers the same set of namespace files', () => {
    const byLang = new Map(languages.map((lang) => [lang, new Set(listNamespaces(lang))] as const));
    const allNamespaces = new Set([...byLang.values()].flatMap((s) => [...s]));

    const problems: string[] = [];
    for (const ns of [...allNamespaces].sort()) {
      const missingFrom = languages.filter((lang) => !byLang.get(lang)!.has(ns));
      if (missingFrom.length > 0) {
        problems.push(`"${ns}.json" is missing from: ${missingFrom.join(', ')}`);
      }
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  const namespaces = [...new Set(languages.flatMap((lang) => listNamespaces(lang)))].sort();

  for (const ns of namespaces) {
    it(`"${ns}" namespace has identical, non-empty keys in every language`, () => {
      const flatByLang = new Map(
        languages
          .filter((lang) => listNamespaces(lang).includes(ns))
          .map((lang) => [lang, flatten(readNamespace(lang, ns))] as const),
      );

      const allKeys = new Set<string>();
      for (const flat of flatByLang.values()) for (const key of flat.keys()) allKeys.add(key);

      const problems: string[] = [];
      for (const key of [...allKeys].sort()) {
        for (const [lang, flat] of flatByLang) {
          const value = flat.get(key);
          if (value === undefined) {
            problems.push(`[${ns}] "${key}" missing in "${lang}"`);
          } else if (value.trim().length === 0) {
            problems.push(`[${ns}] "${key}" is empty in "${lang}"`);
          }
        }
      }

      expect(problems, `Key-parity violations in "${ns}":\n${problems.join('\n')}`).toEqual([]);
    });
  }
});
