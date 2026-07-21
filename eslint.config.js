import js from "@eslint/js";
import tseslint from "typescript-eslint";

// docs/05 §2 — engine purity: banned inside packages/engine.
const ENGINE_PURITY_MSG =
  "Engine purity (docs/05 §2): no nondeterminism/I-O in packages/engine — randomness flows through state.rng.";

const bannedEngineGlobals = [
  "Date",
  "crypto",
  "setTimeout",
  "setInterval",
  "setImmediate",
  "clearTimeout",
  "clearInterval",
  "clearImmediate",
  "queueMicrotask",
  "console"
].map((name) => ({ name, message: ENGINE_PURITY_MSG }));

const bannedEngineImports = [
  "crypto",
  "node:crypto",
  "timers",
  "node:timers",
  "node:timers/promises",
  "fs",
  "node:fs",
  "node:fs/promises",
  "path",
  "node:path",
  "os",
  "node:os",
  "http",
  "node:http",
  "https",
  "node:https",
  "net",
  "node:net",
  "child_process",
  "node:child_process",
  "worker_threads",
  "node:worker_threads"
].map((name) => ({ name, message: ENGINE_PURITY_MSG }));

// docs/05 §7 / CLAUDE.md cross-cutting i18n rule — "no hardcoded user-facing strings anywhere in
// the client." This is a hand-written local rule rather than a new eslint-plugin dependency (T-306
// §7 allows either; see T-306 Implementation notes for why): it flags raw JSX text nodes and raw
// string-literal JSX children, which is what "hardcoded copy" looks like in the AST. It does NOT
// flag JSX *attribute* string literals (className, htmlFor, key, …) — those aren't rendered
// copy, and flagging them would drag non-i18n plumbing into an i18n lint rule.
const I18N_GUARD_MSG =
  "Raw JSX text — route user-facing copy through t('ns.key') instead of hardcoding it (docs/05 §7 i18n).";

/** @type {import('eslint').Rule.RuleModule} */
const noRawJsxTextRule = {
  meta: {
    type: "problem",
    docs: { description: I18N_GUARD_MSG }
  },
  create(context) {
    return {
      JSXText(node) {
        if (node.value.trim().length > 0) {
          context.report({ node, message: I18N_GUARD_MSG });
        }
      },
      JSXExpressionContainer(node) {
        // Only care about the "child of an element/fragment" position — a string literal used as
        // an attribute value (e.g. `key={'x'}`) is a different AST shape (JSXAttribute), untouched
        // by this visitor.
        const parentType = node.parent && node.parent.type;
        if (parentType !== "JSXElement" && parentType !== "JSXFragment") return;
        const expr = node.expression;
        if (expr && expr.type === "Literal" && typeof expr.value === "string" && expr.value.trim().length > 0) {
          context.report({ node, message: I18N_GUARD_MSG });
        }
      }
    };
  }
};

const i18nGuardPlugin = { rules: { "no-raw-text": noRawJsxTextRule } };

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/coverage/**",
      "**/*.tsbuildinfo"
    ]
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module"
      }
    },
    rules: {
      "no-console": ["warn", { allow: ["warn", "error"] }]
    }
  },
  {
    files: ["packages/engine/src/**/*.ts", "packages/engine/src/**/*.tsx"],
    rules: {
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: ENGINE_PURITY_MSG }
      ],
      "no-restricted-globals": ["error", ...bannedEngineGlobals],
      "no-restricted-imports": ["error", { paths: bannedEngineImports }]
    }
  },
  {
    // docs/05 §7 (T-306): every user-facing string in the client goes through t('ns.key').
    files: ["apps/client/src/**/*.tsx"],
    // `DevTuningPanel.tsx` is a DEV-ONLY harbour/port-marker calibration overlay (gated behind
    // `import.meta.env.DEV` or an explicit `?tune=1`/localStorage flag, see `board3d/devTuning.ts`)
    // — never part of a real player's session, so its scratch calibration labels aren't "user-facing
    // copy" in the sense this rule exists to catch (same reasoning as the `*.test.tsx` exclusion
    // below: not every `.tsx` file under `src/` renders to an actual player).
    ignores: ["apps/client/src/**/*.test.tsx", "apps/client/src/board3d/DevTuningPanel.tsx"],
    plugins: { "i18n-guard": i18nGuardPlugin },
    rules: {
      "i18n-guard/no-raw-text": "error"
    }
  },
  {
    // T-1505: offline Node preprocessing scripts (e.g. `optimize-models.mjs`) — never shipped to the
    // browser, run only via `pnpm run optimize-models`. No other block here declares Node's ambient
    // globals (the browser client never needs them), so this one grants just the two this script
    // actually uses rather than pulling in a whole `globals` package dependency for one file.
    files: ["apps/client/scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { console: "readonly", Buffer: "readonly" }
    }
  }
];
