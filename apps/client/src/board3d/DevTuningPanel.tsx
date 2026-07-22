// DEV-ONLY (or `?tune=1`/localStorage-flagged, see `devTuning.ts`) live tuning panel for the harbour
// ship/lighthouse model's base orientation + the port marker's fit in the harbour housing. Mounted
// by `Board3D.tsx` as a plain HTML overlay OUTSIDE the `<Canvas>` (react-three-fiber hooks don't run
// out here, and this component doesn't need them — it only reads/writes the zustand store
// `devTuning.ts` exports, which `HexTiles.tsx`'s harbour/marker components read live on every
// render). No new dependency: plain React + native `<input type="range">`/number inputs.
//
// Opening it: on the built prod server (:8080, where `import.meta.env.DEV` is false) append
// `?tune=1` to the URL once — it persists itself to `localStorage['hexhaven:tune']`, so it keeps
// showing on subsequent loads without the query string; `?tune=0` turns it back off.
import { useState } from 'react';
import {
  DEV_TUNING_DEFAULTS,
  HARBOR_TYPE_IDS,
  HARBOR_VARIANT_IDS,
  useDevTuningStore,
  type DevTuningValues,
} from './devTuning';

const PANEL_BG = 'rgba(20, 22, 18, 0.88)';
const PANEL_BORDER = 'rgba(255, 255, 255, 0.18)';
const TEXT = 'rgba(255, 255, 255, 0.92)';
const TEXT_DIM = 'rgba(255, 255, 255, 0.62)';

function fmt(value: number, decimals: number): string {
  return value.toFixed(decimals);
}

/** One labeled range slider + live numeric readout — the task's "display the current numeric value
 *  next to every slider" requirement. */
function SliderRow({
  label,
  value,
  min,
  max,
  step,
  decimals,
  unit = '',
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  decimals: number;
  unit?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '76px 1fr 58px', alignItems: 'center', gap: 6 }}>
      <span style={{ color: TEXT_DIM, fontSize: 11 }}>{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: '100%' }}
      />
      {/* Editable number field (not just a readout) so exact values (0, 120, …) can be TYPED — the
          range slider is hard to land precisely on a specific number by dragging (user). */}
      <input
        type="number"
        min={min}
        max={max}
        step={step}
        value={Number(fmt(value, decimals))}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(n);
        }}
        title={unit ? `${unit}` : undefined}
        style={{
          width: 58,
          color: TEXT,
          fontSize: 11,
          fontFamily: 'monospace',
          textAlign: 'right',
          background: 'rgba(0,0,0,0.25)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 3,
          padding: '1px 3px',
        }}
      />
    </div>
  );
}

/** One labeled colour swatch/picker + editable hex field — the colour analog of `SliderRow`. */
function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '76px 1fr 72px', alignItems: 'center', gap: 6 }}>
      <span style={{ color: TEXT_DIM, fontSize: 11 }}>{label}</span>
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} style={{ width: '100%', height: 20, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }} />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: 72,
          color: TEXT,
          fontSize: 11,
          fontFamily: 'monospace',
          textAlign: 'right',
          background: 'rgba(0,0,0,0.25)',
          border: '1px solid rgba(255,255,255,0.15)',
          borderRadius: 3,
          padding: '1px 3px',
        }}
      />
    </div>
  );
}

function SectionTitle({ children }: { children: string }) {
  return (
    <div style={{ color: TEXT, fontSize: 12, fontWeight: 700, marginTop: 10, marginBottom: 4 }}>{children}</div>
  );
}

/** The "copy values" readout — a plain text dump of the harbour + marker colours/thresholds the user
 *  sets with the pickers, ready to hard-code into `HARBOR_HEIGHT_BAND` (`terrainStlModels.ts`) and
 *  `PORT_MARKER_*` (`portMarkerModels.ts`). */
function valuesReadout(v: DevTuningValues): string {
  const lines = [
    '// Harbour hull colours (terrainStlModels.ts):',
    `export const HARBOR_HEIGHT_BAND: HeightBandPalette = { base: '${v.harborBaseColor}', feature: '${v.harborFeatureColor}', thresholdFraction: ${fmt(v.harborThresholdByVariant.ship1, 2)} };`,
    `export const HARBOR_HEIGHT_BAND_BLEND = ${fmt(v.harborBlend, 2)};`,
    'export const HARBOR_THRESHOLD_BY_VARIANT: Record<HarborVariantId, number> = {',
    ...HARBOR_VARIANT_IDS.map((id) => `  ${id}: ${fmt(v.harborThresholdByVariant[id], 2)},`),
    '};',
    '',
    '// Port marker colours (portMarkerModels.ts):',
    `export const PORT_MARKER_BASE_COLOR = '${v.markerBaseColor}';`,
    `export const PORT_MARKER_COLOR_BLEND = ${fmt(v.markerColorBlend, 2)};`,
    'export const PORT_MARKER_TOP_COLOR: Record<HarborType, string> = {',
    ...HARBOR_TYPE_IDS.map((t) => `  ${t}: '${v.markerTopColor[t]}',`),
    '};',
    'export const PORT_MARKER_THRESHOLD_BY_TYPE: Record<HarborType, number> = {',
    ...HARBOR_TYPE_IDS.map((t) => `  ${t}: ${fmt(v.markerThresholdByType[t], 2)},`),
    '};',
    '',
    '// Environment (constants.ts):',
    `export const BACKGROUND_COLOR = '${v.bgColor}';`,
    `export const ENV_INTENSITY = ${fmt(v.envIntensity, 2)};`,
    `export const AMBIENT_INTENSITY = ${fmt(v.ambientIntensity, 2)};`,
    `export const HEMI_INTENSITY = ${fmt(v.hemiIntensity, 2)};`,
    `export const KEY_INTENSITY = ${fmt(v.keyIntensity, 2)}; // colour '${v.keyColor}'`,
    `export const FILL_INTENSITY = ${fmt(v.fillIntensity, 2)}; // colour '${v.fillColor}'`,
    `export const SPOT_INTENSITY = ${fmt(v.spotIntensity, 2)}; // colour '${v.spotColor}'`,
    `export const SPOT_ANGLE_DEG = ${fmt(v.spotAngleDeg, 0)};`,
    `export const SPOT_PENUMBRA = ${fmt(v.spotPenumbra, 2)};`,
    `export const TABLE_WOOD_COLOR = '${v.tableColor}';`,
    `export const TABLE_SQUARE_FACTOR = ${fmt(v.tableSizeFactor, 2)};`,
    `export const TABLE_THICKNESS = ${fmt(v.tableThickness, 1)};`,
    `export const TABLE_ROUGHNESS = ${fmt(v.tableRoughness, 2)};`,
    `export const CONTACT_SHADOW_COLOR = '${v.contactColor}';`,
    `export const CONTACT_SHADOW_OPACITY = ${fmt(v.contactOpacity, 2)};`,
    `export const CONTACT_SHADOW_BLUR = ${fmt(v.contactBlur, 1)};`,
    `export const CONTACT_SHADOW_SCALE_FACTOR = ${fmt(v.contactScaleFactor, 2)};`,
  ];
  return lines.join('\n');
}

/** Top-level dev tuning panel — `Board3D.tsx` mounts this unconditionally when
 *  `useDevTuningAvailable()` is true; this component itself does the store subscription + rendering. */
export function DevTuningPanel() {
  const tuning = useDevTuningStore();
  const [collapsed, setCollapsed] = useState(false);
  const [copied, setCopied] = useState(false);

  const set = (patch: Partial<DevTuningValues>) => tuning.set(patch);

  const handleCopy = () => {
    const text = valuesReadout(tuning);
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(text).catch(() => undefined);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div
      style={{
        position: 'absolute',
        top: 8,
        left: 8,
        zIndex: 20,
        width: collapsed ? 'auto' : 300,
        maxHeight: 'calc(100% - 16px)',
        overflowY: 'auto',
        background: PANEL_BG,
        border: `1px solid ${PANEL_BORDER}`,
        borderRadius: 8,
        padding: collapsed ? '6px 10px' : 10,
        color: TEXT,
        fontFamily: 'ui-sans-serif, system-ui, sans-serif',
        backdropFilter: 'blur(4px)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 700 }}>Harbour &amp; Marker Colours (dev)</span>
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          style={{
            background: 'transparent',
            border: `1px solid ${PANEL_BORDER}`,
            borderRadius: 4,
            color: TEXT,
            fontSize: 11,
            cursor: 'pointer',
            padding: '2px 6px',
          }}
        >
          {collapsed ? 'open' : 'hide'}
        </button>
      </div>

      {!collapsed && (
        <>
          <SectionTitle>1. Harbour colours</SectionTitle>
          <ColorRow label="base" value={tuning.harborBaseColor} onChange={(v) => set({ harborBaseColor: v })} />
          <ColorRow label="feature" value={tuning.harborFeatureColor} onChange={(v) => set({ harborFeatureColor: v })} />
          <SliderRow
            label="blend"
            value={tuning.harborBlend}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            onChange={(v) => set({ harborBlend: v })}
          />
          <div style={{ color: TEXT_DIM, fontSize: 11, fontWeight: 700, marginTop: 6 }}>threshold by ship</div>
          {HARBOR_VARIANT_IDS.map((id) => (
            <SliderRow
              key={id}
              label={id}
              value={tuning.harborThresholdByVariant[id]}
              min={0}
              max={1}
              step={0.01}
              decimals={2}
              onChange={(v) => set({ harborThresholdByVariant: { ...tuning.harborThresholdByVariant, [id]: v } })}
            />
          ))}

          <SectionTitle>2. Marker colours</SectionTitle>
          <ColorRow label="base" value={tuning.markerBaseColor} onChange={(v) => set({ markerBaseColor: v })} />
          <SliderRow
            label="blend"
            value={tuning.markerColorBlend}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            onChange={(v) => set({ markerColorBlend: v })}
          />
          <div style={{ color: TEXT_DIM, fontSize: 11, fontWeight: 700, marginTop: 6 }}>top colour by resource</div>
          {HARBOR_TYPE_IDS.map((t) => (
            <ColorRow
              key={t}
              label={t}
              value={tuning.markerTopColor[t]}
              onChange={(v) => set({ markerTopColor: { ...tuning.markerTopColor, [t]: v } })}
            />
          ))}
          <div style={{ color: TEXT_DIM, fontSize: 11, fontWeight: 700, marginTop: 6 }}>threshold by resource</div>
          {HARBOR_TYPE_IDS.map((t) => (
            <SliderRow
              key={t}
              label={t}
              value={tuning.markerThresholdByType[t]}
              min={0}
              max={1}
              step={0.01}
              decimals={2}
              onChange={(v) => set({ markerThresholdByType: { ...tuning.markerThresholdByType, [t]: v } })}
            />
          ))}

          <SectionTitle>3. Environment · light</SectionTitle>
          <ColorRow label="background" value={tuning.bgColor} onChange={(v) => set({ bgColor: v })} />
          <SliderRow label="IBL" value={tuning.envIntensity} min={0} max={2} step={0.02} decimals={2} onChange={(v) => set({ envIntensity: v })} />
          <SliderRow label="ambient" value={tuning.ambientIntensity} min={0} max={2} step={0.02} decimals={2} onChange={(v) => set({ ambientIntensity: v })} />
          <SliderRow label="hemisphere" value={tuning.hemiIntensity} min={0} max={2} step={0.02} decimals={2} onChange={(v) => set({ hemiIntensity: v })} />
          <SliderRow label="key" value={tuning.keyIntensity} min={0} max={5} step={0.05} decimals={2} onChange={(v) => set({ keyIntensity: v })} />
          <ColorRow label="key colour" value={tuning.keyColor} onChange={(v) => set({ keyColor: v })} />
          <SliderRow label="fill" value={tuning.fillIntensity} min={0} max={3} step={0.02} decimals={2} onChange={(v) => set({ fillIntensity: v })} />
          <ColorRow label="fill colour" value={tuning.fillColor} onChange={(v) => set({ fillColor: v })} />
          <SliderRow label="spot" value={tuning.spotIntensity} min={0} max={12} step={0.1} decimals={1} onChange={(v) => set({ spotIntensity: v })} />
          <ColorRow label="spot colour" value={tuning.spotColor} onChange={(v) => set({ spotColor: v })} />
          <SliderRow label="spot angle" value={tuning.spotAngleDeg} min={5} max={85} step={1} decimals={0} unit="°" onChange={(v) => set({ spotAngleDeg: v })} />
          <SliderRow label="spot soft" value={tuning.spotPenumbra} min={0} max={1} step={0.02} decimals={2} onChange={(v) => set({ spotPenumbra: v })} />

          <SectionTitle>4. Table &amp; shadow</SectionTitle>
          <ColorRow label="table" value={tuning.tableColor} onChange={(v) => set({ tableColor: v })} />
          <SliderRow label="table size" value={tuning.tableSizeFactor} min={0.6} max={6} step={0.05} decimals={2} unit="×" onChange={(v) => set({ tableSizeFactor: v })} />
          <SliderRow label="thickness" value={tuning.tableThickness} min={1} max={160} step={1} decimals={0} onChange={(v) => set({ tableThickness: v })} />
          <SliderRow label="roughness" value={tuning.tableRoughness} min={0} max={1} step={0.02} decimals={2} onChange={(v) => set({ tableRoughness: v })} />
          <ColorRow label="shadow" value={tuning.contactColor} onChange={(v) => set({ contactColor: v })} />
          <SliderRow label="shadow opacity" value={tuning.contactOpacity} min={0} max={1} step={0.02} decimals={2} onChange={(v) => set({ contactOpacity: v })} />
          <SliderRow label="shadow blur" value={tuning.contactBlur} min={0} max={12} step={0.1} decimals={1} onChange={(v) => set({ contactBlur: v })} />
          <SliderRow label="shadow size" value={tuning.contactScaleFactor} min={0.6} max={6} step={0.05} decimals={2} unit="×" onChange={(v) => set({ contactScaleFactor: v })} />

          <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
            <button
              type="button"
              onClick={handleCopy}
              style={{
                flex: 1,
                background: 'rgba(255,255,255,0.12)',
                border: `1px solid ${PANEL_BORDER}`,
                borderRadius: 4,
                color: TEXT,
                fontSize: 11,
                cursor: 'pointer',
                padding: '4px 6px',
              }}
            >
              {copied ? 'copied!' : 'copy values'}
            </button>
            <button
              type="button"
              onClick={() => tuning.reset()}
              style={{
                background: 'rgba(255,255,255,0.12)',
                border: `1px solid ${PANEL_BORDER}`,
                borderRadius: 4,
                color: TEXT,
                fontSize: 11,
                cursor: 'pointer',
                padding: '4px 6px',
              }}
            >
              reset
            </button>
          </div>

          <pre
            style={{
              marginTop: 8,
              marginBottom: 0,
              padding: 6,
              background: 'rgba(0,0,0,0.35)',
              borderRadius: 4,
              fontSize: 10,
              lineHeight: 1.4,
              color: TEXT,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
          >
            {valuesReadout(tuning)}
          </pre>
        </>
      )}
    </div>
  );
}

// Re-exported so a test (or the panel's own future variants) can assert against the exact starting
// values without re-deriving them.
export { DEV_TUNING_DEFAULTS };
