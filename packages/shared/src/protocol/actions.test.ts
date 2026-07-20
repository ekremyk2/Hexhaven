import { describe, it, expect } from 'vitest';
import {
  ActionSchema,
  ResourceBundleSchema,
  HexIdSchema,
  VertexIdSchema,
  EdgeIdSchema,
  SeatSchema,
} from './actions.js';
import type { ActionSchemaMatchesAction } from './actions.js';
import { GEOMETRY, GEOMETRY_EXT56, buildGeometry } from '../geometry.js';
import { SCENARIOS } from '../scenario.js';
import type { Action, HexId, VertexId, EdgeId } from '../types.js';

describe('type-level contract', () => {
  it('ActionSchema output type structurally equals the hand-written Action union (compile-time check)', () => {
    // If z.infer<typeof ActionSchema> and Action ever diverge, this line fails to *compile*
    // (and therefore `pnpm -w typecheck` fails the build) before this assertion is even reached.
    const typeContractHolds: ActionSchemaMatchesAction = true;
    expect(typeContractHolds).toBe(true);
  });
});

describe('ID schemas', () => {
  // Bounds must cover the LARGEST supported board across ALL modes — base 19-hex, 30-hex EXT56, and
  // every Seafarers scenario (biggest today: "Heading for New Shores" 4p = 42 hexes / 117 vertices /
  // 158 edges). A too-small cap rejects valid placements as BAD_ACTION (B-17 was EXT56>base; B-25 was
  // Seafarers>EXT56). Computed here from the same geometries the schema derives from, so the test
  // can't go stale when a new/larger board ships.
  const geos = [
    GEOMETRY,
    GEOMETRY_EXT56,
    ...Object.values(SCENARIOS).flatMap((s) => Object.values(s.boards).map((b) => buildGeometry(b.layout))),
  ];
  const maxHex = Math.max(...geos.map((g) => g.hexes.length)) - 1;
  const maxVertex = Math.max(...geos.map((g) => g.vertices.length)) - 1;
  const maxEdge = Math.max(...geos.map((g) => g.edges.length)) - 1;

  describe('HexIdSchema', () => {
    it('accepts 0..maxHex across every board (base/EXT56/scenarios)', () => {
      expect(HexIdSchema.safeParse(0).success).toBe(true);
      expect(HexIdSchema.safeParse(29).success).toBe(true); // EXT56 max still valid
      expect(HexIdSchema.safeParse(maxHex).success).toBe(true); // largest scenario hex
    });

    it('rejects beyond the largest board + non-integers', () => {
      expect(HexIdSchema.safeParse(maxHex + 1).success).toBe(false);
      expect(HexIdSchema.safeParse(-1).success).toBe(false);
      expect(HexIdSchema.safeParse(1.5).success).toBe(false);
    });
  });

  describe('VertexIdSchema', () => {
    it('accepts 0..maxVertex across every board', () => {
      expect(VertexIdSchema.safeParse(0).success).toBe(true);
      expect(VertexIdSchema.safeParse(79).success).toBe(true); // EXT56 max still valid
      expect(VertexIdSchema.safeParse(maxVertex).success).toBe(true); // largest scenario vertex
    });

    it('rejects beyond the largest board', () => {
      expect(VertexIdSchema.safeParse(maxVertex + 1).success).toBe(false);
      expect(VertexIdSchema.safeParse(-1).success).toBe(false);
    });
  });

  describe('EdgeIdSchema', () => {
    it('accepts 0..maxEdge across every board', () => {
      expect(EdgeIdSchema.safeParse(0).success).toBe(true);
      expect(EdgeIdSchema.safeParse(108).success).toBe(true); // EXT56 max still valid
      expect(EdgeIdSchema.safeParse(maxEdge).success).toBe(true); // largest scenario edge
    });

    it('rejects beyond the largest board', () => {
      expect(EdgeIdSchema.safeParse(maxEdge + 1).success).toBe(false);
      expect(EdgeIdSchema.safeParse(-1).success).toBe(false);
    });
  });

  describe('SeatSchema', () => {
    it('accepts 0-5', () => {
      for (const seat of [0, 1, 2, 3, 4, 5]) {
        expect(SeatSchema.safeParse(seat).success).toBe(true);
      }
    });

    it('rejects out-of-range seats', () => {
      expect(SeatSchema.safeParse(6).success).toBe(false);
      expect(SeatSchema.safeParse(-1).success).toBe(false);
    });
  });
});

describe('ResourceBundleSchema', () => {
  it('accepts a bundle with valid positive counts', () => {
    const result = ResourceBundleSchema.safeParse({ brick: 1, ore: 3 });
    expect(result.success).toBe(true);
    expect(result.success && result.data).toEqual({ brick: 1, ore: 3 });
  });

  it('accepts the empty bundle', () => {
    expect(ResourceBundleSchema.safeParse({}).success).toBe(true);
  });

  it('rejects negative counts', () => {
    expect(ResourceBundleSchema.safeParse({ brick: -1 }).success).toBe(false);
  });

  it('rejects zero counts (must be omitted, not zero, per docs/03 §2)', () => {
    expect(ResourceBundleSchema.safeParse({ brick: 0 }).success).toBe(false);
  });

  it('rejects unknown resource keys', () => {
    expect(ResourceBundleSchema.safeParse({ gold: 1 }).success).toBe(false);
  });

  it('rejects non-integer counts', () => {
    expect(ResourceBundleSchema.safeParse({ brick: 1.5 }).success).toBe(false);
  });
});

describe('ActionSchema', () => {
  const validSamples: Action[] = [
    { type: 'placeSetupSettlement', vertex: 0 as VertexId },
    { type: 'placeSetupRoad', edge: 0 as EdgeId },
    { type: 'rollDice' },
    { type: 'discard', cards: { brick: 2, lumber: 1 } },
    { type: 'moveRobber', hex: 5 as HexId },
    { type: 'steal', from: 2 },
    { type: 'buildRoad', edge: 10 as EdgeId },
    { type: 'buildSettlement', vertex: 20 as VertexId },
    { type: 'buildCity', vertex: 30 as VertexId },
    { type: 'buyDevCard' },
    { type: 'playKnight' },
    { type: 'playRoadBuilding' },
    { type: 'placeFreeRoad', edge: 15 as EdgeId },
    { type: 'playYearOfPlenty', a: 'brick', b: 'ore' },
    { type: 'playMonopoly', resource: 'wool' },
    { type: 'bankTrade', give: 'grain', receive: 'ore' },
    { type: 'offerTrade', give: { brick: 1 }, receive: { ore: 1 } },
    { type: 'respondTrade', response: 'accept' },
    { type: 'confirmTrade', with: 1 },
    { type: 'cancelTrade' },
    { type: 'endTurn' },
    // T-904 (cardMods modifier).
    { type: 'playCardModCard', card: 'bumperCrop' },
    { type: 'playCardModCombo', combo: 'rideByNight', edge: 0 as EdgeId, hex: 5 as HexId },
    // T-905 ("The Helpers of Hexhaven" modifier) — the 9 `useHelper` variants are nested under their
    // own `helper`-discriminated union (see actions.ts's header comment); one sample here proves
    // the whole `z.union([discriminatedUnion, UseHelperActionSchema])` restructuring round-trips.
    { type: 'useHelper', helper: 'mayor', resource: 'brick' },
    { type: 'swapHelper', take: 'priest' },
    // Spy peek reveal (redact.ts hidden-info UX fix): the "begin" half of a two-step Spy play.
    { type: 'peekSpyTarget', targetSeat: 1 },
  ];

  it.each(validSamples.map((sample) => [sample.type, sample] as const))(
    'round-trips a valid %s action',
    (_label, sample) => {
      const result = ActionSchema.safeParse(sample);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toEqual(sample);
      }
    },
  );

  it('covers exactly the 26 Action variants', () => {
    expect(validSamples).toHaveLength(26);
    const types = new Set(validSamples.map((s) => s.type));
    expect(types.size).toBe(26);
  });

  describe('useHelper architect (peek reveal)', () => {
    it('round-trips the beginPeek shape', () => {
      const sample: Action = { type: 'useHelper', helper: 'architect', beginPeek: true };
      const result = ActionSchema.safeParse(sample);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(sample);
    });

    it('round-trips the commit shape (unchanged)', () => {
      const sample: Action = {
        type: 'useHelper',
        helper: 'architect',
        pick: 1,
        replace: 'ore',
        substitute: 'wool',
      };
      const result = ActionSchema.safeParse(sample);
      expect(result.success).toBe(true);
      if (result.success) expect(result.data).toEqual(sample);
    });

    it('rejects a shape with neither beginPeek nor pick', () => {
      expect(ActionSchema.safeParse({ type: 'useHelper', helper: 'architect' }).success).toBe(false);
    });
  });

  it('rejects an unknown action type', () => {
    const result = ActionSchema.safeParse({ type: 'flyToTheMoon' });
    expect(result.success).toBe(false);
  });

  // 80/30/109 are all VALID now (Seafarers boards are bigger than EXT56, B-25) — reject only well
  // beyond the largest supported board.
  it('rejects an action with an out-of-range vertex id', () => {
    expect(ActionSchema.safeParse({ type: 'buildSettlement', vertex: 99999 }).success).toBe(false);
  });

  it('rejects an action with an out-of-range hex id', () => {
    expect(ActionSchema.safeParse({ type: 'moveRobber', hex: 99999 }).success).toBe(false);
  });

  it('rejects an action with an out-of-range edge id', () => {
    expect(ActionSchema.safeParse({ type: 'buildRoad', edge: 99999 }).success).toBe(false);
  });

  it('rejects discard with negative bundle counts', () => {
    const result = ActionSchema.safeParse({ type: 'discard', cards: { brick: -2 } });
    expect(result.success).toBe(false);
  });

  it('rejects an action with extra unknown fields', () => {
    const result = ActionSchema.safeParse({ type: 'endTurn', extra: 'nope' });
    expect(result.success).toBe(false);
  });

  it('rejects a non-object payload', () => {
    expect(ActionSchema.safeParse('endTurn').success).toBe(false);
    expect(ActionSchema.safeParse(null).success).toBe(false);
  });
});
