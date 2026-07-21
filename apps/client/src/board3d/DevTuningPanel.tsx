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
  BAND_TERRAIN_IDS,
  DEV_TUNING_DEFAULTS,
  HARBOR_VARIANT_IDS,
  MARKER_OFFSET_RANGE,
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

function SectionTitle({ children }: { children: string }) {
  return (
    <div style={{ color: TEXT, fontSize: 12, fontWeight: 700, marginTop: 10, marginBottom: 4 }}>{children}</div>
  );
}

/** The "copy values" readout (task requirement 4) — a plain text dump the user reads back to the PM
 *  to hard-code into `HARBOR_VARIANT_YAW_OFFSET` (`terrainStlModels.ts`) / `PORT_MARKER_OFFSET`/
 *  `PORT_MARKER_YAW`/`PORT_MARKER_SCALE` (`portMarkerModels.ts`). Degrees are shown alongside the
 *  radians those constants actually store, so no manual conversion is needed either way. */
function valuesReadout(v: DevTuningValues): string {
  const lines = [
    '// harbor ship base orientation (apply to normalizeStlGeometry\'s Z-up->Y-up remap, i.e. BEFORE harbor.yaw):',
    `//   rotation X/Y/Z (deg): ${fmt(v.harborBaseRotXDeg, 1)}, ${fmt(v.harborBaseRotYDeg, 1)}, ${fmt(v.harborBaseRotZDeg, 1)}`,
    `//   rotation X/Y/Z (rad): ${fmt((v.harborBaseRotXDeg * Math.PI) / 180, 4)}, ${fmt((v.harborBaseRotYDeg * Math.PI) / 180, 4)}, ${fmt((v.harborBaseRotZDeg * Math.PI) / 180, 4)}`,
    `//   scale multiplier: ${fmt(v.harborBaseScale, 3)}`,
    '',
    '// HARBOR_VARIANT_YAW_OFFSET override, PER VARIANT (terrainStlModels.ts):',
    `//   enabled: ${v.yawOverrideEnabled}`,
    'export const HARBOR_VARIANT_YAW_OFFSET: Record<HarborVariantId, number> = {',
    ...HARBOR_VARIANT_IDS.map(
      (id) =>
        `  ${id}: ${fmt((v.variantYawDeg[id] * Math.PI) / 180, 4)}, // ${fmt(v.variantYawDeg[id], 1)} deg`,
    ),
    '};',
    '',
    '// Port-marker fit, PER VARIANT (portMarkerModels.ts):',
    'export const PORT_MARKER_YAW_BY_VARIANT: Record<HarborVariantId, number> = {',
    ...HARBOR_VARIANT_IDS.map(
      (id) => `  ${id}: ${fmt((v.markerYawDeg[id] * Math.PI) / 180, 4)}, // ${fmt(v.markerYawDeg[id], 1)} deg`,
    ),
    '};',
    ...HARBOR_VARIANT_IDS.map(
      (id) =>
        `// ${id} offset { x: ${fmt(v.markerOffset[id].x, 3)}, y: ${fmt(v.markerOffset[id].y, 3)}, z: ${fmt(v.markerOffset[id].z, 3)} }  scale ${fmt(v.markerScale[id], 3)}`,
    ),
    '',
    '// Colour-band thresholds (terrainStlModels.ts) — live-calibrated:',
    'export const TERRAIN_HEIGHT_BAND_THRESHOLDS = {',
    ...BAND_TERRAIN_IDS.map((id) => `  ${id}: ${fmt(v.terrainThreshold[id], 2)}, // thresholdFraction`),
    '};',
    `export const HARBOR_HEIGHT_BAND_THRESHOLD = ${fmt(v.harborThreshold, 2)}; // HARBOR_HEIGHT_BAND.thresholdFraction`,
    `export const HEIGHT_BAND_BLEND_FRACTION = ${fmt(v.blendFraction, 2)};`,
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
        <span style={{ fontSize: 12, fontWeight: 700 }}>Harbour/Port Tuning (dev)</span>
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
          <SectionTitle>1. Harbour ship/lighthouse base orientation (all models)</SectionTitle>
          <SliderRow
            label="rot X"
            value={tuning.harborBaseRotXDeg}
            min={-180}
            max={180}
            step={1}
            decimals={0}
            unit="°"
            onChange={(v) => set({ harborBaseRotXDeg: v })}
          />
          <SliderRow
            label="rot Y"
            value={tuning.harborBaseRotYDeg}
            min={-180}
            max={180}
            step={1}
            decimals={0}
            unit="°"
            onChange={(v) => set({ harborBaseRotYDeg: v })}
          />
          <SliderRow
            label="rot Z"
            value={tuning.harborBaseRotZDeg}
            min={-180}
            max={180}
            step={1}
            decimals={0}
            unit="°"
            onChange={(v) => set({ harborBaseRotZDeg: v })}
          />
          <SliderRow
            label="scale"
            value={tuning.harborBaseScale}
            min={0.1}
            max={4}
            step={0.01}
            decimals={2}
            unit="×"
            onChange={(v) => set({ harborBaseScale: v })}
          />

          <SectionTitle>2. Ship yaw offset override (per model variant)</SectionTitle>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: TEXT_DIM, marginBottom: 4 }}>
            <input
              type="checkbox"
              checked={tuning.yawOverrideEnabled}
              onChange={(e) => set({ yawOverrideEnabled: e.target.checked })}
            />
            override enabled
          </label>
          {HARBOR_VARIANT_IDS.map((id) => (
            <SliderRow
              key={id}
              label={id}
              value={tuning.variantYawDeg[id]}
              min={-180}
              max={180}
              step={1}
              decimals={0}
              unit="°"
              onChange={(v) => set({ variantYawDeg: { ...tuning.variantYawDeg, [id]: v } })}
            />
          ))}

          <SectionTitle>3. Port marker fit (per model variant)</SectionTitle>
          {HARBOR_VARIANT_IDS.map((id) => (
            <div key={id} style={{ marginBottom: 4 }}>
              <div style={{ color: TEXT_DIM, fontSize: 11, fontWeight: 700, marginTop: 4 }}>{id}</div>
              <SliderRow
                label="offset X"
                value={tuning.markerOffset[id].x}
                min={-MARKER_OFFSET_RANGE}
                max={MARKER_OFFSET_RANGE}
                step={0.005}
                decimals={3}
                onChange={(v) => set({ markerOffset: { ...tuning.markerOffset, [id]: { ...tuning.markerOffset[id], x: v } } })}
              />
              <SliderRow
                label="offset Y"
                value={tuning.markerOffset[id].y}
                min={-MARKER_OFFSET_RANGE}
                max={MARKER_OFFSET_RANGE}
                step={0.005}
                decimals={3}
                onChange={(v) => set({ markerOffset: { ...tuning.markerOffset, [id]: { ...tuning.markerOffset[id], y: v } } })}
              />
              <SliderRow
                label="offset Z"
                value={tuning.markerOffset[id].z}
                min={-MARKER_OFFSET_RANGE}
                max={MARKER_OFFSET_RANGE}
                step={0.005}
                decimals={3}
                onChange={(v) => set({ markerOffset: { ...tuning.markerOffset, [id]: { ...tuning.markerOffset[id], z: v } } })}
              />
              <SliderRow
                label="yaw"
                value={tuning.markerYawDeg[id]}
                min={-180}
                max={180}
                step={1}
                decimals={0}
                unit="°"
                onChange={(v) => set({ markerYawDeg: { ...tuning.markerYawDeg, [id]: v } })}
              />
              <SliderRow
                label="scale"
                value={tuning.markerScale[id]}
                min={0.1}
                max={4}
                step={0.01}
                decimals={2}
                unit="×"
                onChange={(v) => set({ markerScale: { ...tuning.markerScale, [id]: v } })}
              />
            </div>
          ))}

          <SectionTitle>4. Colour thresholds (live)</SectionTitle>
          {BAND_TERRAIN_IDS.map((id) => (
            <SliderRow
              key={id}
              label={id}
              value={tuning.terrainThreshold[id]}
              min={0}
              max={1}
              step={0.01}
              decimals={2}
              onChange={(v) => set({ terrainThreshold: { ...tuning.terrainThreshold, [id]: v } })}
            />
          ))}
          <SliderRow
            label="harbor"
            value={tuning.harborThreshold}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            onChange={(v) => set({ harborThreshold: v })}
          />
          <SliderRow
            label="blend"
            value={tuning.blendFraction}
            min={0}
            max={1}
            step={0.01}
            decimals={2}
            onChange={(v) => set({ blendFraction: v })}
          />

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
