// Fixture builders shared by src/hud/**'s tests (T-402 requirement 6): small, override-friendly
// `PlayerView`-entry factories so each test only states what it cares about.
import type { OtherPlayerView, OwnPlayerView, PlayerView } from '@hexhaven/engine';
import type { EdgeId, ResourceType, Seat, VertexId } from '@hexhaven/shared';

export function makeOtherPlayerView(seat: Seat, overrides: Partial<OtherPlayerView> = {}): OtherPlayerView {
  return {
    seat,
    color: 'red',
    resourceCount: 0,
    devCardCount: 0,
    playedKnights: 0,
    piecesLeft: { roads: 15, settlements: 5, cities: 4 },
    roads: [] as EdgeId[],
    settlements: [] as VertexId[],
    cities: [] as VertexId[],
    ...overrides,
  };
}

const ZERO_RESOURCES: Record<ResourceType, number> = { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 0 };

export function makeOwnPlayerView(seat: Seat, overrides: Partial<OwnPlayerView> = {}): OwnPlayerView {
  return {
    seat,
    color: 'blue',
    resources: { ...ZERO_RESOURCES },
    devCards: [],
    playedKnights: 0,
    piecesLeft: { roads: 15, settlements: 5, cities: 4 },
    roads: [] as EdgeId[],
    settlements: [] as VertexId[],
    cities: [] as VertexId[],
    ...overrides,
  };
}

export function makeAwards(overrides: Partial<PlayerView['awards']> = {}): PlayerView['awards'] {
  return {
    longestRoad: { holder: null, length: 0 },
    largestArmy: { holder: null, count: 0 },
    ...overrides,
  };
}
