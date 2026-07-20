// DebugPanel (T-305 requirement 4): collapsible sidebar — raw phase/turn JSON, full per-seat
// resource/dev-card truth (it's hot-seat: no secrets to hide from the person holding the mouse),
// an action log with a copy-to-clipboard repro bundle `{seed, tokenMethod, actions}` (docs/02 §4's
// "config + action log" bug-report format) and a "replay bundle" paste box, plus the generic action
// controls (requirement 5) that make a full game playable before Phase-4's real HUD/build-flow
// screens exist: roll / end turn / board-pick modes (reusing T-304's `uiMode`) / a raw action-JSON
// box that covers everything else (discard, dev cards, bank trades, …) — "clunky is fine, complete
// is mandatory". Dev-only styling (raw JSON dumps in a monospace block) is explicitly fine here
// per the task; the interactive controls still go through the `ui/` primitives + tokens.
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { computeVp } from '@hexhaven/engine';
import { ActionSchema } from '@hexhaven/shared';
import type { Action, GameState } from '@hexhaven/shared';
import { Badge, Button, TextInput } from '../ui';
import type { UiMode } from '../store/types';
import type { LocalTransport, ReproBundle } from './localTransport';
import type { ToastInput } from './SeatBar';

export interface DebugPanelProps {
  state: GameState;
  uiMode: UiMode;
  onSetUiMode: (mode: UiMode) => void;
  onSendAction: (action: Action) => void;
  transport: LocalTransport;
  onToast: (input: ToastInput) => void;
}

function isBundleShape(value: unknown): value is ReproBundle {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v.seed === 'string' && typeof v.tokenMethod === 'string' && Array.isArray(v.actions);
}

const MODE_BUTTONS: { mode: UiMode; labelKey: string }[] = [
  { mode: 'placingRoad', labelKey: 'hotseat.debug.pickRoad' },
  { mode: 'placingSettlement', labelKey: 'hotseat.debug.pickSettlement' },
  { mode: 'placingCity', labelKey: 'hotseat.debug.pickCity' },
  { mode: 'movingRobber', labelKey: 'hotseat.debug.pickRobber' },
];

// T-705: Seafarers-only board-pick modes (ships + pirate). Shown only in a seafarers game.
const SEAFARERS_MODE_BUTTONS: { mode: UiMode; labelKey: string }[] = [
  { mode: 'placingShip', labelKey: 'hotseat.debug.buildShip' },
  { mode: 'movingShip', labelKey: 'hotseat.debug.moveShip' },
  { mode: 'movingPirate', labelKey: 'hotseat.debug.movePirate' },
];

export function DebugPanel({ state, uiMode, onSetUiMode, onSendAction, transport, onToast }: DebugPanelProps) {
  const { t } = useTranslation('game');
  const [collapsed, setCollapsed] = useState(false);
  const [rawAction, setRawAction] = useState('');
  const [replayText, setReplayText] = useState('');

  function handleCopyBundle() {
    const bundle = transport.exportBundle();
    const text = JSON.stringify(bundle);
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
    onToast({ kind: 'info', message: t('hotseat.debug.bundleCopied') });
  }

  function handleSubmitRawAction() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawAction);
    } catch {
      onToast({ kind: 'error', message: t('hotseat.debug.rawActionParseError') });
      return;
    }
    const result = ActionSchema.safeParse(parsed);
    if (!result.success) {
      onToast({ kind: 'error', message: t('hotseat.debug.rawActionInvalid') });
      return;
    }
    onSendAction(result.data);
  }

  function handleReplay() {
    let parsed: unknown;
    try {
      parsed = JSON.parse(replayText);
    } catch {
      onToast({ kind: 'error', message: t('hotseat.debug.replayParseError') });
      return;
    }
    if (!isBundleShape(parsed)) {
      onToast({ kind: 'error', message: t('hotseat.debug.replayInvalid') });
      return;
    }
    const result = transport.replayBundle(parsed);
    if (!result.ok) {
      onToast({ kind: 'error', message: result.error });
      return;
    }
    onToast({ kind: 'info', message: t('hotseat.debug.replayDone', { version: result.stateVersion }) });
  }

  if (collapsed) {
    return (
      <Button variant="subtle" size="sm" onClick={() => setCollapsed(false)}>
        {t('hotseat.debug.expand')}
      </Button>
    );
  }

  return (
    // Priority 1 UI overhaul: this panel's raw-JSON/action-log dumps can get tall — `min-h-0` +
    // `overflow-y-auto` (+ the `h-full` the caller's wrapper now provides) make IT scroll
    // internally instead of blowing out the whole hot-seat page's height (docs' "each panel that
    // can overflow gets its OWN overflow-y:auto" rule).
    <aside className="hexhaven-panel flex h-full min-h-0 w-full max-w-sm flex-shrink-0 flex-col gap-4 overflow-y-auto p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-ui text-14 font-semibold text-ink">{t('hotseat.debug.title')}</h2>
        <Button variant="subtle" size="sm" onClick={() => setCollapsed(true)}>
          {t('hotseat.debug.collapse')}
        </Button>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="font-ui text-12 font-semibold uppercase text-ink-soft">
          {t('hotseat.debug.actionsTitle')}
        </h3>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => onSendAction({ type: 'rollDice' })}>
            {t('hotseat.debug.roll')}
          </Button>
          <Button size="sm" onClick={() => onSendAction({ type: 'endTurn' })}>
            {t('hotseat.debug.endTurn')}
          </Button>
          {[...MODE_BUTTONS, ...(state.ext?.seafarers ? SEAFARERS_MODE_BUTTONS : [])].map(({ mode, labelKey }) => (
            <Button
              key={mode}
              variant={uiMode === mode ? 'primary' : 'subtle'}
              size="sm"
              onClick={() => onSetUiMode(mode)}
            >
              {t(labelKey)}
            </Button>
          ))}
        </div>
        <TextInput
          label={t('hotseat.debug.rawActionLabel')}
          value={rawAction}
          onChange={(e) => setRawAction(e.target.value)}
          placeholder={t('hotseat.debug.rawActionPlaceholder')}
        />
        <Button size="sm" onClick={handleSubmitRawAction}>
          {t('hotseat.debug.rawActionSubmit')}
        </Button>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-ui text-12 font-semibold uppercase text-ink-soft">
          {t('hotseat.debug.truthTitle')}
        </h3>
        <div className="overflow-x-auto rounded-md bg-gray-900 p-2 text-xs text-gray-100">
          <pre>{JSON.stringify({ phase: state.phase, turn: state.turn, trade: state.trade }, null, 2)}</pre>
        </div>
        <table className="w-full text-left font-ui text-12 text-ink">
          <thead>
            <tr className="text-ink-soft">
              <th className="pr-2">{t('hotseat.debug.table.seat')}</th>
              <th className="pr-2">{t('hotseat.debug.table.resources')}</th>
              <th className="pr-2">{t('hotseat.debug.table.devCards')}</th>
              <th>{t('hotseat.debug.table.vp')}</th>
            </tr>
          </thead>
          <tbody>
            {state.players.map((p) => (
              <tr key={p.seat}>
                <td className="pr-2">{p.seat}</td>
                <td className="pr-2 font-mono">{JSON.stringify(p.resources)}</td>
                <td className="pr-2 font-mono">{p.devCards.map((c) => c.type).join(', ')}</td>
                <td>
                  <Badge>{computeVp(state, p.seat).total}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="font-ui text-12 font-semibold uppercase text-ink-soft">{t('hotseat.debug.logTitle')}</h3>
        <Button size="sm" onClick={handleCopyBundle}>
          {t('hotseat.debug.copyBundle')}
        </Button>
        <div className="max-h-40 overflow-y-auto rounded-md bg-gray-900 p-2 text-xs text-gray-100">
          <pre>{JSON.stringify(transport.getActionLog(), null, 2)}</pre>
        </div>
        <TextInput
          label={t('hotseat.debug.replayLabel')}
          value={replayText}
          onChange={(e) => setReplayText(e.target.value)}
          placeholder={t('hotseat.debug.replayPlaceholder')}
        />
        <Button size="sm" onClick={handleReplay}>
          {t('hotseat.debug.replaySubmit')}
        </Button>
      </section>
    </aside>
  );
}
