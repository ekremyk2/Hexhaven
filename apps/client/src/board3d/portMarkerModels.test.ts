// Tests for PART B's port-marker type->model map — pure string lookups, no react/three/DOM needed
// (same `environment: "node"` convention as terrainStlModels.test.ts).
import { describe, expect, it } from 'vitest';
import type { HarborType } from '@hexhaven/shared';
import {
  PORT_MARKER_FOOTPRINT,
  PORT_MARKER_OFFSET,
  PORT_MARKER_SCALE,
  PORT_MARKER_URL,
  PORT_MARKER_YAW,
  PORT_MARKER_YAW_BY_VARIANT,
  portMarkerUrlFor,
} from './portMarkerModels';

const ALL_HARBOR_TYPES: HarborType[] = ['generic', 'brick', 'lumber', 'wool', 'grain', 'ore'];

describe('portMarkerUrlFor', () => {
  it('maps every HarborType key to a marker url', () => {
    for (const type of ALL_HARBOR_TYPES) {
      expect(typeof portMarkerUrlFor(type)).toBe('string');
      expect(portMarkerUrlFor(type).length).toBeGreaterThan(0);
    }
  });

  it('every HarborType has its own distinct marker (no accidental aliasing)', () => {
    const urls = new Set(ALL_HARBOR_TYPES.map((t) => portMarkerUrlFor(t)));
    expect(urls.size).toBe(ALL_HARBOR_TYPES.length);
  });

  it('resource keys resolve to their own resource marker file (lumber/grain, not a "wood"/"wheat" alias)', () => {
    expect(portMarkerUrlFor('lumber')).toMatch(/portMarkerLumber\.stl/i);
    expect(portMarkerUrlFor('grain')).toMatch(/portMarkerGrain\.stl/i);
    expect(portMarkerUrlFor('brick')).toMatch(/portMarkerBrick\.stl/i);
    expect(portMarkerUrlFor('wool')).toMatch(/portMarkerWool\.stl/i);
    expect(portMarkerUrlFor('ore')).toMatch(/portMarkerOre\.stl/i);
    expect(portMarkerUrlFor('generic')).toMatch(/portMarkerGeneric\.stl/i);
  });

  it('PORT_MARKER_URL is a total map — every ALL_HARBOR_TYPES key is present', () => {
    for (const type of ALL_HARBOR_TYPES) expect(PORT_MARKER_URL[type]).toBeDefined();
  });
});

describe('port marker fit tunables', () => {
  it('PORT_MARKER_FOOTPRINT is a sane positive size', () => {
    expect(PORT_MARKER_FOOTPRINT).toBeGreaterThan(0);
  });

  it('marker fit constants are finite (user-calibrated values, in flux)', () => {
    for (const v of [PORT_MARKER_OFFSET.x, PORT_MARKER_OFFSET.y, PORT_MARKER_OFFSET.z, PORT_MARKER_YAW, PORT_MARKER_SCALE]) {
      expect(Number.isFinite(v)).toBe(true);
    }
    expect(PORT_MARKER_SCALE).toBeGreaterThan(0);
  });

  it('marker world-yaw is defined and finite for every ship model', () => {
    for (const id of ['ship1', 'ship2', 'ship3', 'lighthouse'] as const) {
      expect(Number.isFinite(PORT_MARKER_YAW_BY_VARIANT[id])).toBe(true);
    }
  });
});
