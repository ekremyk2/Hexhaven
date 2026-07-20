// RoadBuildingBar (T-705, Seafarers S11.1): during the Road Building sub-phase a Seafarers player may
// place each of the free pieces as a road OR a ship. The T-304 interaction hook auto-enters
// `placingFreeRoad`; this bar lets the mover toggle the current free piece to `placingFreeShip` (and
// back), highlighting the matching legal targets. Self-contained store wiring like `RobberOverlay` —
// renders nothing outside its own sub-phase, and nothing at all in a base game (roads only).
import { useTranslation } from 'react-i18next';
import type { PlayerView } from '@hexhaven/engine';
import type { GameState } from '@hexhaven/shared';
import { useGameView, useStore, useUiMode } from '../store';
import { isMyDecision } from '../store/uiMode';
import { Button } from '../ui';

function isSeafarers(view: PlayerView): boolean {
  return (view as unknown as { ext?: { seafarers?: unknown } }).ext?.seafarers != null;
}

export function RoadBuildingBar() {
  const view = useGameView() as PlayerView | null;
  const uiMode = useUiMode();
  const setUiMode = useStore((s) => s.setUiMode);
  const { t } = useTranslation('game');

  if (!view) return null;
  // Only the mover, only during the free-placement sub-phase, only in a Seafarers game.
  if (
    view.phase.kind !== 'roadBuilding' ||
    !isMyDecision(view as unknown as GameState, view.me) ||
    !isSeafarers(view)
  ) {
    return null;
  }

  const placingShip = uiMode === 'placingFreeShip';
  const remaining = view.phase.remaining;

  return (
    // Priority 1/2 UI overhaul: FIXED top-center overlay (same treatment/z-index as
    // `robber/RobberOverlay.tsx`'s banners) — mounted after the game shell's footer, a plain in-flow
    // div here could be clipped by the shell's `overflow-hidden` instead of always being reachable.
    <div className="pointer-events-none fixed inset-x-0 top-16 z-20 flex justify-center px-4 md:top-20">
      <div
        className="hexhaven-panel pointer-events-auto flex flex-col gap-2 px-3 py-2"
        data-testid="road-building-bar"
      >
        <p className="font-ui text-14 font-semibold text-ink">
          {t('controls.freeBuild.prompt', { count: remaining })}
        </p>
        <div className="flex items-center gap-2">
          <Button
            data-testid="free-build-road"
            size="sm"
            variant={placingShip ? 'subtle' : 'primary'}
            onClick={() => setUiMode('placingFreeRoad')}
          >
            {t('controls.freeBuild.road')}
          </Button>
          <Button
            data-testid="free-build-ship"
            size="sm"
            variant={placingShip ? 'primary' : 'subtle'}
            onClick={() => setUiMode('placingFreeShip')}
          >
            {t('controls.freeBuild.ship')}
          </Button>
        </div>
      </div>
    </div>
  );
}
