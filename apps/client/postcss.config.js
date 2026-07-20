// FIX (T-307, see tailwind.config.js's own comment): tailwindcss's PostCSS plugin, given no
// explicit `config` path, resolves relative to `process.cwd()` — which is the workspace root when
// `.claude/launch.json` starts vite, not apps/client. Point it at this file's own tailwind.config.js
// by absolute path so config discovery no longer depends on whatever cwd started the process.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const configDir = dirname(fileURLToPath(import.meta.url));

export default {
  plugins: {
    tailwindcss: { config: join(configDir, 'tailwind.config.js') },
    autoprefixer: {},
  },
};
