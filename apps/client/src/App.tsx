import { useTranslation } from 'react-i18next';
import { BrowserRouter, Route, Routes, useLocation } from 'react-router-dom';
import { ConnectionBanner } from './components/ConnectionBanner';
import { SettingsMenu } from './components/SettingsMenu';
import { Toasts } from './components/Toasts';
import BoardPreview from './routes/BoardPreview';
import Game from './routes/Game';
import Home from './routes/Home';
import Hotseat from './routes/Hotseat';
import Lobby from './routes/Lobby';
import Styleguide from './routes/Styleguide';
import { useLobbyState } from './store';

/** Mounted inside `<BrowserRouter>` (T-401 requirement 4) so the header can read the current route
 * (room code once inside `/lobby/:id` or `/game/:id`) and the lobby slice (the code itself). */
function AppShell() {
  const { t } = useTranslation(['common', 'lobby']);
  const location = useLocation();
  const lobby = useLobbyState();
  const inRoom = /^\/(lobby|game)\//.test(location.pathname);
  // Priority 1 UI overhaul: the game screen (`/game/:id`, `/hotseat`) owns its OWN internal
  // scrolling per-panel (Scoreboard/bank/log/hand each scroll themselves) and must never let this
  // outer route wrapper scroll too — a second scrollbar here is exactly how the dice/toasts/banners
  // used to end up "buried" below the fold. Every other route (home/lobby/styleguide) still scrolls
  // normally if its content overflows.
  const isFixedViewportRoute = /^\/(game|hotseat)(\/|$)/.test(location.pathname);

  return (
    // T-307: app-level table backdrop (deep-ocean gradient + vignette, theme/tokens.css
    // `.hexhaven-table`) mounts here so every route floats over it; route content itself is out
    // of this task's scope (T-401/T-402 own screen layouts).
    // Fixed-viewport flex column: header + banner are shrink-0, the route area takes the rest. The
    // game route fills it exactly (no page scroll); other routes scroll inside it if they overflow.
    // `100dvh` (not `100vh`) so mobile browser chrome (address bar show/hide) never leaves a sliver
    // of the page scrollable underneath.
    <div className="hexhaven-table flex h-[100dvh] flex-col overflow-hidden">
      <header className="flex shrink-0 items-center justify-between border-b border-panel-edge/30 bg-table-b px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="font-display text-16 font-semibold text-ink-ondark">{t('app.title')}</span>
          {inRoom && lobby.code ? (
            <span className="font-ui text-14 text-ink-ondark/80">
              {t('lobby:room.codeLabel')} <span className="font-ui tracking-widest">{lobby.code}</span>
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          <SettingsMenu />
        </div>
      </header>
      <div className="shrink-0">
        <ConnectionBanner />
      </div>
      <div className={['min-h-0 flex-1', isFixedViewportRoute ? 'overflow-hidden' : 'overflow-auto'].join(' ')}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/lobby/:gameId" element={<Lobby />} />
          <Route path="/game/:gameId" element={<Game />} />
          <Route path="/hotseat" element={<Hotseat />} />
          <Route path="/board" element={<BoardPreview />} />
          {/* Playtest fix: unlisted (no nav link, path-only) but no longer dev-gated — the PM/user
              needs to review the panel gallery against a production build too, not just `pnpm dev`. */}
          <Route path="/styleguide" element={<Styleguide />} />
        </Routes>
      </div>
      <Toasts />
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AppShell />
    </BrowserRouter>
  );
}

export default App;
