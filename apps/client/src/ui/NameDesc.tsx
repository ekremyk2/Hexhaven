// NameDesc (card/ability clarity pass): the shared "name + one-line effect description" block used
// everywhere a player needs to identify what a card/helper/ability IS and DOES at a glance —
// `devcards/DevCardsPanel.tsx`, `citiesKnights/ProgressHandPanel.tsx`, and
// `cardMods/CardModsComboPanel.tsx` already rendered this exact two-line shape (semibold name, soft
// one-liner effect text below) as ad-hoc inline JSX; this factors it out so `helpers/HelpersHud.tsx`
// and `citiesKnights/ImprovementsPanel.tsx` (this task's two surfaces that were showing a name alone,
// or hiding the effect text in a hover-only tooltip) use the identical pattern rather than a bespoke
// one. Purely presentational — callers still own their own i18n lookups/testids.
import type { ReactNode } from 'react';

export interface NameDescProps {
  /** The card/helper/ability's real name — rendered semibold, full ink color. */
  name: ReactNode;
  /** The one-line "what it does" (+ cost, if any) — rendered in the softer ink-soft tone below. */
  desc: ReactNode;
  /** Optional decorative icon/glyph rendered before the name (e.g. `HelperIcon`/`ResourceIcon`). */
  icon?: ReactNode;
  nameTestId?: string;
  descTestId?: string;
  /** Wrapper element's own data-testid, when a caller needs to assert the whole block exists. */
  testId?: string;
  className?: string;
  /** Tailwind max-width class for the desc line, so it wraps instead of overflowing a narrow card —
   *  defaults to the width every existing caller (`DevCardsPanel`/`ProgressHandPanel`) already used. */
  descMaxWidthClassName?: string;
}

export function NameDesc({
  name,
  desc,
  icon,
  nameTestId,
  descTestId,
  testId,
  className,
  descMaxWidthClassName = 'max-w-[16rem]',
}: NameDescProps) {
  return (
    <div className={className} data-testid={testId}>
      <p className="flex items-center gap-1.5 font-ui text-12 font-semibold text-ink" data-testid={nameTestId}>
        {icon}
        {name}
      </p>
      <p className={`${descMaxWidthClassName} font-ui text-12 text-ink-soft`} data-testid={descTestId}>
        {desc}
      </p>
    </div>
  );
}
