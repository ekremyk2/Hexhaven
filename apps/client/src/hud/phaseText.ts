// phase -> i18n key map (T-402 requirement 3): drives the DicePanel's subdued "waiting for X…"
// line for non-actors, and is reused as-is by T-407's log for a phase-context line. Keys resolve
// under `game.json`'s `hud.phase` tree (both `en`/`tr`, key-parity enforced by
// `src/i18n/parity.test.ts`). Pure/total: every `Phase.kind` maps to exactly one key.
import type { Phase } from '@hexhaven/shared';

export function phaseTextKey(phase: Phase): string {
  switch (phase.kind) {
    case 'setup':
      return `hud.phase.setup.${phase.expect}`;
    case 'preRoll':
      return 'hud.phase.preRoll';
    case 'discard':
      return 'hud.phase.discard';
    case 'moveRobber':
      return 'hud.phase.moveRobber';
    case 'steal':
      return 'hud.phase.steal';
    case 'roadBuilding':
      return 'hud.phase.roadBuilding';
    // Seafarers gold-field choice (S9, T-703). Placeholder line — full UI is T-704/705.
    case 'chooseGoldResource':
      return 'hud.phase.chooseGoldResource';
    case 'main':
      return 'hud.phase.main';
    // 5–6 Special Building Phase (X12, T-602). Placeholder line — T-603 wires the real SBP UI/copy.
    case 'specialBuild':
      return 'hud.phase.specialBuild';
    // Caravans camel-placement vote (§TB4.2, T-1004). Placeholder line — T-1008 wires the real UI.
    case 'caravanVote':
      return 'hud.phase.caravanVote';
    case 'ended':
      return 'hud.phase.ended';
    default: {
      const exhaustiveCheck: never = phase;
      throw new Error(`BUG: phaseTextKey missing a case for ${JSON.stringify(exhaustiveCheck)}`);
    }
  }
}
