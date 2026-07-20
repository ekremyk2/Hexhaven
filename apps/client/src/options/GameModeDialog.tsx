// GameModeDialog: the "Choose your game" popup (user request — a PUBG-style mode picker that
// replaces the long inline expansion/scenario/player-count stack on the Home create card). It's a
// pure presentation relayer over the tested OptionsPanel helpers — no config/engine logic lives
// here, so the exact combination guard the engine/server enforce still drives every transition.
//
// Layout: a grid of the four mutually-exclusive board WORLDS (base / Seafarers / Traders &
// Barbarians / Explorers & Pirates) + Cities & Knights as a combinable ADD-ON toggle (the official
// C&K + Seafarers game / C&K on the base board) + player count + the contextual scenario/board
// sub-picker + (5–6) turn rule + the prominent winnability warning.
import { useTranslation } from 'react-i18next';
import type { RoomConfig } from '@hexhaven/shared';
import { boardModeForExpansions, boardPresetsForMode } from '@hexhaven/shared';
import { Badge, Modal, Panel, SegmentedControl } from '../ui';
import { BoardPresetPicker } from './BoardPresetPicker';
import {
  EP_SCENARIOS,
  GAME_MODES,
  isCkAddonAvailable,
  isCkAddonOn,
  isGameModeShipped,
  selectedBoard,
  selectedEPScenario,
  selectedGameMode,
  selectedScenario,
  selectedTBScenario,
  selectedTurnRule,
  SBP_ENABLED,
  SHIPPED_EXPANSIONS,
  TB_SCENARIOS,
  FIVE_SIX_TURN_RULES,
  type FiveSixTurnRule,
  type GameMode,
  playerCountOptions,
  winnabilityFor,
  withBoard,
  withCkAddon,
  withEPScenario,
  withGameMode,
  withPlayerCount,
  withScenario,
  withTBScenario,
  withTurnRule,
  type BoardChoice,
} from './OptionsPanel';

export interface GameModeDialogProps {
  open: boolean;
  onClose: () => void;
  value: RoomConfig;
  onChange: (next: RoomConfig) => void;
}

/** One decorative glyph per board world (real names come from i18n) — mirrors the glyph-per-choice
 *  style of ThemeToggle/CosmeticThemeSwitcher so the grid stays scannable. */
const MODE_GLYPH: Record<GameMode, string> = {
  base: '🎲',
  seafarers: '⚓',
  tradersBarbarians: '🐫',
  explorersPirates: '🧭',
};

/** Decorative shield glyph for the C&K add-on (referenced, not inlined — see the i18n raw-text guard). */
const CK_GLYPH = '🛡️';

/** i18n name key for a board world — base has its own key; the others reuse the expansion names. */
function modeNameKey(mode: GameMode): string {
  return mode === 'base' ? 'lobby:options.gameMode.base.name' : `lobby:options.expansions.${mode}.name`;
}

export function GameModeDialog({ open, onClose, value, onChange }: GameModeDialogProps) {
  const { t } = useTranslation(['lobby', 'common']);
  const mode = selectedGameMode(value);
  const winnability = winnabilityFor(value);

  const onOffOptions = [
    { value: 'on', label: t('common:ui.on') },
    { value: 'off', label: t('common:ui.off') },
  ];

  return (
    <Modal open={open} onClose={onClose} title={t('lobby:options.gameMode.title')}>
      <div className="flex flex-col gap-4" data-testid="game-mode-dialog">
        {/* Board world — the mutually-exclusive game grid. */}
        <div>
          <p className="mb-2 font-ui text-14 font-medium text-ink">{t('lobby:options.gameMode.chooseGame')}</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {GAME_MODES.map((m) => {
              const active = mode === m;
              const shipped = isGameModeShipped(m);
              return (
                <button
                  key={m}
                  type="button"
                  aria-pressed={active}
                  disabled={!shipped}
                  data-testid={`game-mode-${m}`}
                  onClick={() => onChange(withGameMode(value, m))}
                  className={[
                    'flex flex-col items-center gap-1 rounded-card border p-3 text-center transition-colors',
                    active
                      ? 'border-accent bg-accent/15 text-ink'
                      : 'border-panel-edge bg-panel text-ink-soft hover:bg-panel-edge/20',
                    shipped ? '' : 'cursor-not-allowed opacity-50',
                  ].join(' ')}
                >
                  <span aria-hidden="true" className="text-24 leading-none">{MODE_GLYPH[m]}</span>
                  <span className="font-ui text-12 font-semibold leading-tight">{t(modeNameKey(m))}</span>
                  {!shipped ? <Badge variant="default">{t('lobby:options.comingSoonBadge')}</Badge> : null}
                </button>
              );
            })}
          </div>
        </div>

        {/* Cities & Knights — the one combinable add-on (base board / Seafarers). */}
        {isCkAddonAvailable(value) ? (
          <div className="flex items-center justify-between gap-3 rounded-card border border-panel-edge bg-panel p-2" data-testid="ck-addon">
            <div>
              <p className="flex items-center gap-1.5 font-ui text-14 font-semibold text-ink">
                <span aria-hidden="true">{CK_GLYPH}</span>
                {t('lobby:options.expansions.citiesKnights.name')}
              </p>
              <p className="font-ui text-12 text-ink-soft">{t('lobby:options.gameMode.addonHint')}</p>
            </div>
            <SegmentedControl
              ariaLabel={t('lobby:options.expansions.citiesKnights.name')}
              value={isCkAddonOn(value) ? 'on' : 'off'}
              onChange={(v) => onChange(withCkAddon(value, v === 'on'))}
              options={onOffOptions}
            />
          </div>
        ) : null}

        {/* Players. */}
        <div>
          <p className="mb-1 font-ui text-14 font-medium text-ink">{t('lobby:options.playerCountLabel')}</p>
          <SegmentedControl
            ariaLabel={t('lobby:options.playerCountAria')}
            options={playerCountOptions(value)}
            value={String(value.playerCount)}
            onChange={(v) => onChange(withPlayerCount(value, Number(v) as RoomConfig['playerCount']))}
          />
        </div>

        {/* Scenario / board — contextual to the chosen world. */}
        <ScenarioSection value={value} onChange={onChange} mode={mode} />

        {/* 5–6 turn rule. */}
        {value.expansions.fiveSix ? (
          <div className="flex flex-col gap-2 rounded-card border border-panel-edge bg-panel p-2" data-testid="turn-rule-options">
            <p className="font-ui text-14 font-medium text-ink">{t('lobby:options.turnRule.label')}</p>
            <SegmentedControl
              ariaLabel={t('lobby:options.turnRule.aria')}
              value={selectedTurnRule(value)}
              onChange={(v) => onChange(withTurnRule(value, v as FiveSixTurnRule))}
              options={FIVE_SIX_TURN_RULES.map((rule) => ({
                value: rule,
                label: t(`lobby:options.turnRule.${rule}.name`),
                disabled: rule === 'sbp' && !SBP_ENABLED,
              }))}
            />
            <p className="font-ui text-12 text-ink-soft">{t(`lobby:options.turnRule.${selectedTurnRule(value)}.description`)}</p>
          </div>
        ) : null}

        {/* Prominent winnability warning (never hidden). */}
        {!winnability.winnable ? (
          <Panel role="alert" className="border-l-4 border-l-danger" data-testid="winnability-warning">
            <p className="font-ui text-14 text-ink">
              {t('lobby:options.winnability.warning', {
                max: winnability.maxAchievable === 'unbounded' ? '?' : winnability.maxAchievable,
              })}
            </p>
          </Panel>
        ) : winnability.endless ? (
          <Panel className="border-l-4 border-l-accent" data-testid="winnability-endless-note">
            <p className="font-ui text-14 text-ink-soft">{t('lobby:options.winnability.endless')}</p>
          </Panel>
        ) : null}
      </div>
    </Modal>
  );
}

/** The scenario/board sub-picker for the chosen world (base presets, Seafarers scenario frames, or
 *  the T&B/E&P scenario lists). SHIPPED_EXPANSIONS reference keeps the T&B/E&P sections honest. */
function ScenarioSection({
  value,
  onChange,
  mode,
}: {
  value: RoomConfig;
  onChange: (next: RoomConfig) => void;
  mode: GameMode;
}) {
  const { t } = useTranslation(['lobby']);
  const boardMode = boardModeForExpansions(value.expansions);

  if (mode === 'seafarers') {
    return (
      <div>
        <p className="mb-1 font-ui text-14 font-medium text-ink">{t('lobby:options.gameMode.scenarioLabel')}</p>
        <BoardPresetPicker
          ariaLabel={t('lobby:options.boardAria')}
          presets={boardPresetsForMode('seafarers', value.playerCount)}
          value={selectedScenario(value)}
          onChange={(id) => onChange(withScenario(value, id))}
        />
      </div>
    );
  }

  if (mode === 'tradersBarbarians' && SHIPPED_EXPANSIONS.tradersBarbarians) {
    return (
      <div className="flex flex-col gap-2">
        <p className="font-ui text-14 font-medium text-ink">{t('lobby:options.tbScenario.label')}</p>
        <SegmentedControl
          ariaLabel={t('lobby:options.tbScenario.aria')}
          value={selectedTBScenario(value)}
          onChange={(v) => onChange(withTBScenario(value, v))}
          options={TB_SCENARIOS.map((scenario) => ({ value: scenario, label: t(`lobby:options.tbScenario.${scenario}.name`) }))}
        />
        <p className="font-ui text-12 text-ink-soft">{t(`lobby:options.tbScenario.${selectedTBScenario(value)}.description`)}</p>
      </div>
    );
  }

  if (mode === 'explorersPirates' && SHIPPED_EXPANSIONS.explorersPirates) {
    return (
      <div className="flex flex-col gap-2">
        <p className="font-ui text-14 font-medium text-ink">{t('lobby:options.epScenario.label')}</p>
        <SegmentedControl
          ariaLabel={t('lobby:options.epScenario.aria')}
          value={selectedEPScenario(value)}
          onChange={(v) => onChange(withEPScenario(value, v))}
          options={EP_SCENARIOS.map((scenario) => ({ value: scenario, label: t(`lobby:options.epScenario.${scenario}.name`) }))}
        />
        <p className="font-ui text-12 text-ink-soft">{t(`lobby:options.epScenario.${selectedEPScenario(value)}.description`)}</p>
      </div>
    );
  }

  // Base board world: the random/beginner preset picker.
  return (
    <div>
      <p className="mb-1 font-ui text-14 font-medium text-ink">{t('lobby:options.boardLabel')}</p>
      <BoardPresetPicker
        ariaLabel={t('lobby:options.boardAria')}
        presets={boardPresetsForMode(boardMode)}
        value={selectedBoard(value)}
        onChange={(id) => onChange(withBoard(value, id as BoardChoice))}
      />
    </div>
  );
}
