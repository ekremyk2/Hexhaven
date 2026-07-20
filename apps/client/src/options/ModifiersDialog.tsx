// ModifiersDialog: the "Modifiers" popup menu (converts the T-901 inline multi-select into a
// dedicated Modal, per user request — presentation-only relocation, no engine/config change). All
// the actual toggle/param logic still lives in OptionsPanel.tsx (`SHIPPED_MODIFIERS`,
// `MODIFIER_KEYS`, `withModifierToggled`, `isModifierOn`, `modifierAvailability`, the
// `customConstants` params panel helpers, and the `hexPieces` per-kind picker helpers) — this file
// only reuses that logic and lays it out grouped into labeled sections for scannability.
import { useTranslation } from 'react-i18next';
import type { ModifierId, RoomConfig } from '@hexhaven/shared';
import { BANK_PER_RESOURCE, EXT56_BANK_PER_RESOURCE } from '@hexhaven/shared';
import { CUSTOM_CONSTANTS_BOUNDS, HEX_PIECE_KIND_IDS, modifierAvailability } from '@hexhaven/engine';
import { Badge, Modal, SegmentedControl, TextInput, Tooltip } from '../ui';
import {
  CAP_FIELDS,
  capFieldValue,
  COST_ITEMS,
  costItemValue,
  customTargetVpValue,
  hexPieceKinds,
  isCapFieldLimitless,
  isCustomTargetVpLimitless,
  isHexPieceKindOn,
  isModifierOn,
  RESOURCE_TYPES,
  SHIPPED_MODIFIERS,
  SIMPLE_FIELDS,
  simpleFieldValue,
  startingResourceValue,
  withCapField,
  withCapFieldLimitless,
  withCostItemField,
  withCustomConstants,
  withCustomTargetVp,
  withCustomTargetVpLimitless,
  withHexPieceKindToggled,
  withModifierToggled,
  withStartingResource,
} from './OptionsPanel';

export interface ModifiersDialogProps {
  open: boolean;
  onClose: () => void;
  value: RoomConfig;
  onChange: (next: RoomConfig) => void;
}

/** Section grouping for scannability (user request): every declared `ModifierId` appears in
 *  exactly one group below — "Robber & pieces" (friendlyRobber + the hexPieces per-kind picker),
 *  "Cards" (the deck-affecting modifiers), "House rules" (scoring/timing tweaks + the broad
 *  customConstants panel). `themes` is a client-only localStorage setting, not a `RoomConfig`
 *  modifier, so it stays wherever it currently lives and is NOT one of these groups. */
const MODIFIER_GROUPS: { id: 'robberPieces' | 'cards' | 'houseRules' | 'board'; keys: ModifierId[] }[] = [
  { id: 'robberPieces', keys: ['friendlyRobber', 'hexPieces'] },
  { id: 'cards', keys: ['cardMods', 'eventCards', 'helpers'] },
  { id: 'houseRules', keys: ['customTargetVp', 'combine2sAnd12s', 'playDevSameTurn', 'harbormaster', 'customConstants'] },
  { id: 'board', keys: ['shuffleNumbers', 'hiddenSetupNumbers'] },
];

/** Custom-game cap fields that only apply in a Cities & Knights game — hidden from the panel unless
 *  C&K is selected (playtest: "if there is an option about an expansion, only show it if the
 *  expansion is selected"). The others (settlements/cities/roads) apply to every game. */
const CK_ONLY_CAP_FIELDS = new Set<string>(['maxCityWalls', 'maxKnightsPerLevel', 'maxProgressCards']);

export function ModifiersDialog({ open, onClose, value, onChange }: ModifiersDialogProps) {
  const { t } = useTranslation(['lobby', 'common']);

  const onOffOptions = [
    { value: 'on', label: t('common:ui.on') },
    { value: 'off', label: t('common:ui.off') },
  ];

  // T-901: per-modifier availability for the CURRENT expansion/modifier selection (the engine's
  // compatibility matrix — resolveModules enforces the same check server-side at lobby.create).
  const modifiersAvailability = modifierAvailability(value);

  function renderModifierRow(key: ModifierId) {
    const shipped = SHIPPED_MODIFIERS[key];
    const availability = modifiersAvailability[key];
    const on = isModifierOn(value, key);
    const disabled = !shipped || !availability.available;
    // An incompatibility reason (when present) is more specific than the generic "coming soon"
    // badge, so it takes priority in the tooltip — it's what actually explains why the toggle is
    // greyed out for THIS selection, not just "not built yet".
    const reasonText = !availability.available
      ? t(`lobby:options.modifiers.incompatibleReasons.${availability.reason}`)
      : !shipped
        ? t('lobby:options.comingSoonBadge')
        : null;
    // T-903: hexPieces replaces the on/off toggle with a per-kind multi-select (rendered right
    // after this row, `data-testid="hexpieces-options"`) — this row is heading/description + a
    // live "N selected" badge only, never a SegmentedControl.
    const control =
      key === 'hexPieces' ? (
        <Badge variant={hexPieceKinds(value).length > 0 ? 'gold' : 'default'}>
          {t('lobby:options.modifiers.hexPieces.selectedCount', { count: hexPieceKinds(value).length })}
        </Badge>
      ) : (
        <SegmentedControl
          ariaLabel={t(`lobby:options.modifiers.${key}.name`)}
          disabled={disabled}
          value={on ? 'on' : 'off'}
          onChange={(v) => onChange(withModifierToggled(value, key, v === 'on'))}
          options={onOffOptions}
        />
      );
    return (
      <div
        key={key}
        className="flex items-center justify-between gap-3 rounded-card border border-panel-edge bg-panel p-2"
      >
        <div>
          <p className="flex items-center gap-2 font-ui text-14 font-semibold text-ink">
            <span>{t(`lobby:options.modifiers.${key}.name`)}</span>
            {!shipped ? <Badge variant="default">{t('lobby:options.comingSoonBadge')}</Badge> : null}
          </p>
          <p className="font-ui text-12 text-ink-soft">{t(`lobby:options.modifiers.${key}.description`)}</p>
        </div>
        {reasonText ? <Tooltip content={reasonText}>{control}</Tooltip> : control}
      </div>
    );
  }

  // T-903: the hexPieces per-kind multi-select — replaces the T-902 on/off toggle. Always rendered
  // (picking a kind IS what turns the whole modifier on), one row per declared kind, each
  // independently on/off. Whole-block disabled exactly like any other unshipped/incompatible
  // modifier (`SHIPPED_MODIFIERS`/`modifierAvailability`).
  function renderHexPiecesBlock() {
    return (
      <div
        key="hexPieces-kinds"
        className="flex flex-col gap-2 rounded-card border border-panel-edge bg-panel p-2"
        data-testid="hexpieces-options"
      >
        <p className="font-ui text-14 font-medium text-ink">{t('lobby:options.modifiers.hexPieces.kindsHeading')}</p>
        {/* The robber is the base game's own piece and is ALWAYS in play — it is NOT a togglable hex
            piece, so it isn't a row here (playtest: "robber shouldn't be a locked always-on piece").
            Pick any EXTRA movable pieces below, or none — with nothing selected the hexPieces modifier
            stays off and the game just has the ordinary robber. */}
        <p className="font-ui text-12 text-ink-soft">{t('lobby:options.modifiers.hexPieces.robberNote')}</p>
        <div className="flex flex-col gap-2">
          {HEX_PIECE_KIND_IDS.map((kind) => {
            const hexPiecesDisabled = !SHIPPED_MODIFIERS.hexPieces || !modifiersAvailability.hexPieces.available;
            const kindOn = isHexPieceKindOn(value, kind);
            return (
              <div
                key={kind}
                className="flex items-center justify-between gap-3 rounded-card border border-panel-edge bg-panel p-2"
              >
                <div>
                  <p className="font-ui text-14 font-semibold text-ink">
                    {t(`lobby:options.modifiers.hexPieces.kinds.${kind}.name`)}
                  </p>
                  <p className="font-ui text-12 text-ink-soft">
                    {t(`lobby:options.modifiers.hexPieces.kinds.${kind}.description`)}
                  </p>
                </div>
                <SegmentedControl
                  ariaLabel={t(`lobby:options.modifiers.hexPieces.kinds.${kind}.name`)}
                  disabled={hexPiecesDisabled}
                  value={kindOn ? 'on' : 'off'}
                  onChange={(v) => onChange(withHexPieceKindToggled(value, kind, v === 'on'))}
                  options={onOffOptions}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  function renderCustomTargetVpBlock() {
    if (!isModifierOn(value, 'customTargetVp')) return null;
    // Merged control (playtest): a finite VP target OR "Unlimited" (endless game) — the latter used
    // to be a separate `customConstants.targetVp` limit. The number input disables while unlimited.
    const limitless = isCustomTargetVpLimitless(value);
    return (
      <div
        key="customTargetVp-params"
        className="flex flex-col gap-2 rounded-card border border-panel-edge bg-panel p-2"
        data-testid="custom-target-vp-options"
      >
        <TextInput
          label={t('lobby:options.modifiers.customTargetVp.paramLabel')}
          type="number"
          min={2}
          disabled={limitless}
          value={limitless ? '' : customTargetVpValue(value)}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) onChange(withCustomTargetVp(value, n));
          }}
        />
        <SegmentedControl
          ariaLabel={t('lobby:options.modifiers.customConstants.limitlessAria', {
            field: t('lobby:options.modifiers.customTargetVp.name'),
          })}
          value={limitless ? 'on' : 'off'}
          onChange={(v) => onChange(withCustomTargetVpLimitless(value, v === 'on'))}
          options={[
            { value: 'off', label: t('common:ui.off') },
            { value: 'on', label: t('lobby:options.modifiers.customConstants.limitlessLabel') },
          ]}
        />
      </div>
    );
  }

  function renderCustomConstantsBlock() {
    if (!isModifierOn(value, 'customConstants')) return null;
    // Expansion-gating (playtest): the C&K-only caps only appear when Cities & Knights is selected.
    const ckOn = value.expansions.citiesKnights === true;
    const visibleCapFields = CAP_FIELDS.filter((field) => ckOn || !CK_ONLY_CAP_FIELDS.has(field));
    // A small section heading style shared by every sub-group, so the panel reads as clearly grouped
    // cards rather than one long undifferentiated list (visual pass).
    const sectionHeading = 'font-ui text-12 font-semibold uppercase tracking-wide text-ink-soft';
    const hintClass = 'font-ui text-10 text-ink-soft';
    // Clamp every entry to the SAME bounds the engine's `validateCustomConstantsConfig` enforces, so an
    // out-of-range value can't produce a MODIFIER_INVALID_CONFIG round-trip (playtest: "modifiers
    // should limit for no errors if possible"). `CUSTOM_CONSTANTS_BOUNDS` is the shared source of truth.
    const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, Math.round(n)));
    const rangeHint = (min: number, max: number) => t('lobby:options.modifiers.customConstants.rangeHint', { min, max });
    // Starting resources are additionally capped at bank ÷ playerCount (the bank-supply rule) —
    // computed here since it depends on the live player count / bank size.
    const effBank = value.modifiers?.customConstants?.bankPerResource ?? (value.expansions.fiveSix ? EXT56_BANK_PER_RESOURCE : BANK_PER_RESOURCE);
    const maxStarting = Math.max(0, Math.floor(effBank / value.playerCount));

    const resourceGrid = 'grid grid-cols-[repeat(auto-fit,minmax(4.5rem,1fr))] gap-1.5';
    const resourceInput = (
      res: (typeof RESOURCE_TYPES)[number],
      val: number,
      set: (n: number) => void,
      min: number,
      max: number,
    ) => (
      <div key={res} className="min-w-0">
        <TextInput
          label={t(`lobby:options.modifiers.customConstants.resourceNames.${res}`)}
          type="number"
          min={min}
          max={max}
          value={val}
          onChange={(e) => {
            const n = Number(e.target.value);
            if (Number.isFinite(n)) set(clamp(n, min, max));
          }}
        />
      </div>
    );
    return (
      <div
        key="customConstants-params"
        className="flex flex-col gap-4 rounded-card border border-panel-edge bg-panel p-3"
        data-testid="custom-constants-options"
      >
        {/* Basics */}
        <section className="flex flex-col gap-2">
          <p className={sectionHeading}>{t('lobby:options.modifiers.customConstants.panelHeading')}</p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(8.5rem,1fr))] gap-2">
            {SIMPLE_FIELDS.map((field) => {
              const b = CUSTOM_CONSTANTS_BOUNDS[field];
              return (
                <div key={field} className="min-w-0">
                  <TextInput
                    label={t(`lobby:options.modifiers.customConstants.fields.${field}`)}
                    type="number"
                    min={b.min}
                    max={b.max}
                    value={simpleFieldValue(value, field)}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) onChange(withCustomConstants(value, { [field]: clamp(n, b.min, b.max) }));
                    }}
                  />
                  <p className={hintClass}>{rangeHint(b.min, b.max)}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* Limits — every piece/hand cap pairs a number input with its own "Limitless" toggle
            (docs/07 D-034); the input disables while limitless. C&K-only caps are gated above. */}
        <section className="flex flex-col gap-2 border-t border-panel-edge/70 pt-4">
          <p className={sectionHeading}>{t('lobby:options.modifiers.customConstants.limitsLabel')}</p>
          <div className="grid grid-cols-[repeat(auto-fit,minmax(9.5rem,1fr))] gap-2">
            {visibleCapFields.map((field) => {
              const limitless = isCapFieldLimitless(value, field);
              const current = capFieldValue(value, field);
              const b = CUSTOM_CONSTANTS_BOUNDS[field];
              return (
                <div key={field} className="flex min-w-0 flex-col gap-1 rounded-card border border-panel-edge p-2">
                  <TextInput
                    label={t(`lobby:options.modifiers.customConstants.fields.${field}`)}
                    type="number"
                    min={b.min}
                    max={b.max}
                    disabled={limitless}
                    value={current ?? ''}
                    onChange={(e) => {
                      const n = Number(e.target.value);
                      if (Number.isFinite(n)) onChange(withCapField(value, field, clamp(n, b.min, b.max)));
                    }}
                  />
                  {!limitless ? <p className={hintClass}>{rangeHint(b.min, b.max)}</p> : null}
                  <SegmentedControl
                    ariaLabel={t('lobby:options.modifiers.customConstants.limitlessAria', {
                      field: t(`lobby:options.modifiers.customConstants.fields.${field}`),
                    })}
                    value={limitless ? 'on' : 'off'}
                    onChange={(v) => onChange(withCapFieldLimitless(value, field, v === 'on'))}
                    options={[
                      { value: 'off', label: t('common:ui.off') },
                      { value: 'on', label: t('lobby:options.modifiers.customConstants.limitlessLabel') },
                    ]}
                  />
                </div>
              );
            })}
          </div>
        </section>

        {/* Starting resources — capped per resource at bank ÷ players so the total can never exceed
            the bank supply (the one runtime rule the UI can't express as a static max). */}
        <section className="flex flex-col gap-2 border-t border-panel-edge/70 pt-4">
          <p className={sectionHeading}>{t('lobby:options.modifiers.customConstants.startingResourcesLabel')}</p>
          <div className={resourceGrid}>
            {RESOURCE_TYPES.map((res) =>
              resourceInput(res, startingResourceValue(value, res), (n) => onChange(withStartingResource(value, res, n)), 0, maxStarting),
            )}
          </div>
          <p className={hintClass}>{t('lobby:options.modifiers.customConstants.startingResourcesHint', { max: maxStarting })}</p>
        </section>

        {/* Build costs */}
        <section className="flex flex-col gap-2 border-t border-panel-edge/70 pt-4">
          <p className={sectionHeading}>{t('lobby:options.modifiers.customConstants.costsLabel')}</p>
          <div className="flex flex-col gap-2">
            {COST_ITEMS.map((item) => (
              <div key={item} className="rounded-card border border-panel-edge/70 p-2">
                <p className="mb-1 font-ui text-12 font-medium text-ink">{t(`lobby:options.modifiers.customConstants.costItems.${item}`)}</p>
                <div className={resourceGrid}>
                  {RESOURCE_TYPES.map((res) =>
                    resourceInput(
                      res,
                      costItemValue(value, item, res),
                      (n) => onChange(withCostItemField(value, item, res, n)),
                      CUSTOM_CONSTANTS_BOUNDS.costItem.min,
                      CUSTOM_CONSTANTS_BOUNDS.costItem.max,
                    ),
                  )}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <Modal open={open} onClose={onClose} title={t('lobby:options.modifiersHeading')}>
      <div className="flex flex-col gap-4" data-testid="modifiers-dialog-content">
        {MODIFIER_GROUPS.map((group) => (
          <div key={group.id} data-testid={`modifier-group-${group.id}`}>
            <p className="mb-2 font-ui text-14 font-semibold text-ink">{t(`lobby:options.modifierGroups.${group.id}`)}</p>
            <div className="flex flex-col gap-2">
              {group.keys.map((key) => (
                <div key={key} className="flex flex-col gap-2">
                  {renderModifierRow(key)}
                  {key === 'hexPieces' ? renderHexPiecesBlock() : null}
                  {key === 'customTargetVp' ? renderCustomTargetVpBlock() : null}
                  {key === 'customConstants' ? renderCustomConstantsBlock() : null}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Modal>
  );
}
