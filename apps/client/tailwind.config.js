/** @type {import('tailwindcss').Config} */
// Tailwind theme extension mapping docs/11 §1 design tokens (src/theme/tokens.css) onto utility
// classes (T-307 requirement 1). Values are CSS var() references, not raw hex, so tokens.css stays
// the single source of truth — editing a token there updates every `bg-panel`/`text-ink`/etc.
// utility without touching this file. Everything here is ADDITIVE (new key names) so it can't
// collide with or change the meaning of Tailwind's default scale used by pre-T-307 files.
//
// FIX (found while verifying /styleguide against a live dev server, T-307): Tailwind resolves
// relative `content` globs against `process.cwd()`, not this file's directory (documented
// gotcha). `.claude/launch.json` starts `vite` with the workspace root as cwd, so the previous
// relative glob (pre-existing since T-001) matched zero files and every utility class rendered as
// a no-op — no error, no warning surfaced to typecheck/test/lint, only a Tailwind console warning
// at dev-server runtime ("content option is missing or empty"). Resolving to an absolute path
// here makes matching independent of whatever cwd started the process.
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

// fast-glob (which Tailwind's content scanner uses) requires forward slashes even on Windows —
// `path.join` would emit backslashes here, which glob syntax treats as escape characters.
const configDir = dirname(fileURLToPath(import.meta.url)).split('\\').join('/');

export default {
  content: [
    `${configDir}/src/**/*.{js,jsx,ts,tsx}`,
  ],
  theme: {
    extend: {
      colors: {
        table: {
          a: 'var(--table-a)',
          b: 'var(--table-b)',
        },
        panel: 'var(--panel)',
        'panel-edge': 'var(--panel-edge)',
        ink: 'var(--ink)',
        'ink-soft': 'var(--ink-soft)',
        // Stable "on-fixed-surface" inks + field bg (T-505 dark mode — see tokens.css): don't flip
        // with the theme, so text on the always-dark ocean / on fixed seat & gold fills stays legible.
        'ink-ondark': 'var(--ink-ondark)',
        'ink-onlight': 'var(--ink-onlight)',
        field: 'var(--field)',
        accent: 'var(--accent)',
        'accent-gold': 'var(--accent-gold)',
        danger: 'var(--danger)',
        'danger-solid': 'var(--danger-solid)',
        'on-accent': 'var(--on-accent)',
        seat: {
          0: 'var(--seat-0)',
          1: 'var(--seat-1)',
          2: 'var(--seat-2)',
          3: 'var(--seat-3)',
          4: 'var(--seat-4)',
          5: 'var(--seat-5)',
        },
        terrain: {
          hills: 'var(--t-hills)',
          forest: 'var(--t-forest)',
          pasture: 'var(--t-pasture)',
          fields: 'var(--t-fields)',
          mountains: 'var(--t-mountains)',
          desert: 'var(--t-desert)',
        },
        sea: 'var(--sea)',
        'sea-deep': 'var(--sea-deep)',
        'coast-sand': 'var(--coast-sand)',
        token: {
          face: 'var(--token-face)',
          ring: 'var(--token-ring)',
          red: 'var(--token-red)',
        },
      },
      fontFamily: {
        display: ['Cinzel', 'Georgia', 'Times New Roman', 'serif'],
        ui: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif'],
      },
      // Type scale (docs/11 §1: 12/14/16/20/28/40) as additive numeric keys (`text-12`..`text-40`)
      // — the default `text-xs`/`text-sm`/etc. keys are untouched, so pre-T-307 files don't shift.
      fontSize: {
        12: 'var(--text-xs)',
        14: 'var(--text-sm)',
        16: 'var(--text-base)',
        20: 'var(--text-lg)',
        28: 'var(--text-xl)',
        40: 'var(--text-2xl)',
      },
      borderRadius: {
        panel: 'var(--radius-panel)',
        button: 'var(--radius-button)',
        card: 'var(--radius-card)',
      },
      boxShadow: {
        soft: 'var(--shadow-soft)',
      },
    },
  },
  plugins: [],
};
