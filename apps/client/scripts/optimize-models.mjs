#!/usr/bin/env node
// T-1505 requirement 1 — a repeatable, OFFLINE (never at app runtime) preprocessing step that
// decimates the user's print-resolution terrain/harbor STL models down to a web-friendly triangle
// budget and re-exports them as compact binary STL. This is what keeps the ~35 MB raw source set
// out of the shipped bundle: `apps/client/src/board3d/models/raw/` (gitignored, this machine's raw
// source only) -> `apps/client/src/board3d/models/opt/` (committed, what the app actually loads via
// `?url` imports).
//
// Run with `pnpm --filter @hexhaven/client run optimize-models` after dropping new/updated raw STLs
// into `models/raw/`. Safe to re-run any time — always regenerates every file in `models/opt/` from
// whatever currently sits in `models/raw/` (no incremental/partial state to get out of sync).
//
// Algorithm notes (three.js's own `SimplifyModifier`, ships with `three` — no new dependency):
//  - `SimplifyModifier.modify(geometry, removeCount)` only merges vertices that match on EVERY
//    attribute it keeps (position, uv, normal, ...) before building its collapse graph. A raw STL's
//    `normal` attribute is a flat per-FACE normal duplicated onto all 3 of that face's vertices —
//    two triangles sharing an edge almost never have matching per-vertex normals, so leaving that
//    attribute in place would make `mergeVertices` treat every triangle as topologically isolated
//    (no shared vertices to collapse), and the "simplified" mesh would barely shrink. Stripping
//    `normal` before simplifying (recomputing it after, via `computeVertexNormals()`) is the standard
//    workaround and the one this script uses.
//  - `removeCount` is a VERTEX count, not a triangle count, and it counts against the MERGED
//    (post-`mergeVertices`) vertex count, not the raw non-indexed one (an STL's raw position count is
//    3x its triangle count, every vertex duplicated per adjacent face — passing THAT count in
//    directly asks the algorithm to remove far more vertices than the mesh actually has, and it
//    degrades to warning "No next vertex" and returning a near/fully-empty geometry). So this script
//    merges once itself first (`BufferGeometryUtils.mergeVertices`, the same step `modify()` runs
//    internally) purely to learn the REAL mergeable vertex/triangle count, derives `removeCount` from
//    that (for a closed 2-manifold mesh, Euler's formula gives faces ≈ 2 * vertices, so scaling the
//    merged vertex count by `budget / mergedTriangleCount` estimates the target vertex count), then
//    hands the ORIGINAL (unmerged, normal-stripped) geometry to `modify()` — which merges again
//    itself; a second merge of an already-merged topology is cheap and idempotent, not wasted work.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Mesh } from 'three';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { SimplifyModifier } from 'three/examples/jsm/modifiers/SimplifyModifier.js';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RAW_DIR = join(__dirname, '../src/board3d/models/raw');
const OPT_DIR = join(__dirname, '../src/board3d/models/opt');

/** Post-decimation triangle target. Covers the task's explicit asks (forest ~120k -> 20-25k, desert
 *  ~45k -> 20k) with one uniform number, and is reused for every OTHER model this script processes
 *  (harbors/water/other terrains) for a consistent output set — `SKIP_MARGIN` below spares anything
 *  already close to/under this from a needless (quality-losing) simplification pass. */
const TRI_BUDGET = 20_000;
/** Only decimate a model that's CLEARLY over budget — an already-light model within 15% of the
 *  target is left untouched (re-exported as-is) rather than risk visible artifacts from simplifying
 *  a mesh that barely needed it. */
const SKIP_MARGIN = 1.15;

function triCountOf(geometry) {
  return (geometry.index ? geometry.index.count : geometry.attributes.position.count) / 3;
}

function toArrayBuffer(nodeBuffer) {
  return nodeBuffer.buffer.slice(nodeBuffer.byteOffset, nodeBuffer.byteOffset + nodeBuffer.byteLength);
}

function main() {
  if (!existsSync(RAW_DIR)) {
    console.log(`optimize-models: no raw dir at ${RAW_DIR} — nothing to do (raw source not present on this machine).`);
    return;
  }
  mkdirSync(OPT_DIR, { recursive: true });

  const files = readdirSync(RAW_DIR).filter((f) => f.toLowerCase().endsWith('.stl'));
  if (files.length === 0) {
    console.log(`optimize-models: ${RAW_DIR} has no .stl files — nothing to do.`);
    return;
  }

  const loader = new STLLoader();
  const exporter = new STLExporter();
  const simplifier = new SimplifyModifier();

  let totalRawBytes = 0;
  let totalOptBytes = 0;

  for (const file of files) {
    const rawPath = join(RAW_DIR, file);
    const rawBuf = readFileSync(rawPath);
    totalRawBytes += rawBuf.byteLength;

    let geometry = loader.parse(toArrayBuffer(rawBuf));
    const rawTris = triCountOf(geometry);

    let outGeometry = geometry;
    if (rawTris > TRI_BUDGET * SKIP_MARGIN) {
      // Strip normal/uv before simplifying (see module doc) — STL geometries from STLLoader never
      // carry uv/color, only position + a flat per-face normal, so this is just the normal attribute.
      if (geometry.getAttribute('normal')) geometry.deleteAttribute('normal');
      const merged = BufferGeometryUtils.mergeVertices(geometry.clone());
      const mergedVertexCount = merged.attributes.position.count;
      const mergedTris = triCountOf(merged);
      const targetVertexCount = Math.round(mergedVertexCount * (TRI_BUDGET / mergedTris));
      const removeCount = Math.max(0, mergedVertexCount - targetVertexCount);
      const t0 = Date.now();
      outGeometry = simplifier.modify(geometry, removeCount);
      outGeometry.computeVertexNormals();
      const finalTris = triCountOf(outGeometry);
      console.log(
        `${file}: ${rawTris} tris (raw) -> ${finalTris} tris in ${((Date.now() - t0) / 1000).toFixed(1)}s`,
      );
    } else {
      console.log(`${file}: ${rawTris} tris — already within ${SKIP_MARGIN}x of the ${TRI_BUDGET} budget, kept as-is.`);
    }

    const mesh = new Mesh(outGeometry);
    const stlView = exporter.parse(mesh, { binary: true });
    const outBuf = Buffer.from(stlView.buffer, stlView.byteOffset, stlView.byteLength);
    writeFileSync(join(OPT_DIR, file), outBuf);
    totalOptBytes += outBuf.byteLength;
  }

  const mb = (n) => (n / (1024 * 1024)).toFixed(2);
  console.log(
    `optimize-models: ${files.length} model(s), ${mb(totalRawBytes)} MB raw -> ${mb(totalOptBytes)} MB optimized.`,
  );
}

main();
