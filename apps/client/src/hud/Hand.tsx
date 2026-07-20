// Hand (T-402 requirement 4): the viewer's OWN resource hand. `own` is `OwnPlayerView` (= the
// engine's `PlayerState`, docs/02 §6).
//
// Playtest (user): dev cards used to ALSO render here as one chip per card — a second, ungrouped copy
// of the dev-card list that overflowed its row with a big hand AND showed raw i18n keys for cardMods
// card types (`hud.devCard.trailblazer`). Dev cards now live in ONE place, the grouped
// `devcards/DevCardsPanel.tsx` in the play area, so this component is resources-only. `turnNumber` is
// kept as an accepted-but-ignored prop (it only drove the removed "NEW" badge) so existing call sites
// don't need to change; DevCardsPanel carries the NEW badge now.
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { OwnPlayerView } from '@hexhaven/engine';
import type { ResourceType } from '@hexhaven/shared';
import { usePrefersReducedMotion } from '../theme/motion';
import { RESOURCE_FILL, RESOURCE_GLYPH, RESOURCE_ORDER } from './constants';

export interface HandProps {
  own: OwnPlayerView;
  /** Accepted-but-ignored (see file header): previously drove the dev-card "NEW" badge, now owned by
   *  `DevCardsPanel`. Kept optional so call sites that still pass it don't break. */
  turnNumber?: number;
}

const RESOURCE_GAIN_POP_MS = 500;

export function Hand({ own }: HandProps) {
  const { t } = useTranslation('game');
  const reducedMotion = usePrefersReducedMotion();

  // docs/11 §5 "Production: resource chips fly from hex to the gaining player's panel, staggered
  // 60ms" — simplified to a pop-in-place on the viewer's own resource cells. Driven by comparing
  // consecutive `own.resources` snapshots, not a timer guessing when production happened.
  const prevResourcesRef = useRef(own.resources);
  const [justGained, setJustGained] = useState<Partial<Record<ResourceType, true>>>({});

  useEffect(() => {
    const prev = prevResourcesRef.current;
    const gained: Partial<Record<ResourceType, true>> = {};
    let any = false;
    for (const resource of RESOURCE_ORDER) {
      if (own.resources[resource] > (prev[resource] ?? 0)) {
        gained[resource] = true;
        any = true;
      }
    }
    prevResourcesRef.current = own.resources;
    if (!any || reducedMotion) return undefined;
    setJustGained(gained);
    const timer = setTimeout(() => setJustGained({}), RESOURCE_GAIN_POP_MS);
    return () => clearTimeout(timer);
  }, [own.resources, reducedMotion]);

  return (
    <div className="hexhaven-panel flex flex-wrap items-start gap-3 p-2" data-testid="hand">
      <section className="flex flex-wrap items-end gap-2">
        <h3 className="w-full font-ui text-12 font-semibold uppercase text-ink-soft">
          {t('hud.hand.resourcesTitle')}
        </h3>
        {RESOURCE_ORDER.map((resource, i) => (
          <div
            key={resource}
            data-testid={`hand-resource-${resource}`}
            // Playtest fix (readability): the resource type read as a bare number before — this adds
            // the shared glyph (docs/11 §4 double-coding: glyph + the existing color fill, never
            // color alone) so each cell is identifiable at a glance, plus an aria-label carrying the
            // translated "N <resource>" text for screen readers (the glyph itself is aria-hidden).
            aria-label={t(`log:resource.${resource}`, { count: own.resources[resource] })}
            className={[
              'flex h-14 w-10 flex-col items-center justify-end gap-0.5 rounded-card border border-panel-edge p-1 shadow-soft',
              justGained[resource] ? 'hexhaven-resource-pop' : '',
            ].join(' ')}
            style={{
              backgroundColor: RESOURCE_FILL[resource],
              animationDelay: justGained[resource] ? `${i * 60}ms` : undefined,
            }}
          >
            <span aria-hidden="true" className="text-16 leading-none">
              {RESOURCE_GLYPH[resource]}
            </span>
            <span
              data-testid={`hand-resource-${resource}-count`}
              className="font-ui text-14 font-bold text-ink-ondark"
            >
              {own.resources[resource]}
            </span>
          </div>
        ))}
      </section>
    </div>
  );
}
