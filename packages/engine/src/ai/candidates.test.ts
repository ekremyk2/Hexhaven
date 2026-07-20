// Regression (playtest bug): a bot must not ACCEPT a domestic offer it can't fulfill. main.ts's
// respondTrade doesn't hand-check acceptance, so an accept-without-the-cards leads confirmTrade to
// fail CANT_AFFORD — a dead-end for the offering (human) player. enumerateCandidates must therefore
// only offer `accept` to a responder that currently holds the requested `receive`.
import { describe, expect, it } from 'vitest';
import type { GameState, PlayerState, Seat } from '@hexhaven/shared';
import { stateWith } from '../testkit.js';
import { enumerateCandidates } from './candidates.js';

function withResources(state: GameState, seat: Seat, resources: PlayerState['resources']): GameState {
  return { ...state, players: state.players.map((p) => (p.seat === seat ? { ...p, resources } : p)) };
}

// Owner is seat 0 (testkit base); seat 1 is the responder. Offer: owner gives brick, wants ore.
const OPEN_OFFER = { give: { brick: 1 }, receive: { ore: 1 }, responses: {} } as GameState['trade'];

describe('enumerateCandidates — responder never accepts an unfulfillable domestic offer', () => {
  it('offers ONLY decline when the responder lacks the requested receive', () => {
    const base = stateWith({ trade: OPEN_OFFER });
    const state = withResources(base, 1 as Seat, { brick: 5, lumber: 5, wool: 5, grain: 5, ore: 0 });
    const kinds = enumerateCandidates(state, 1 as Seat).map((a) => a.type === 'respondTrade' ? a.response : a.type);
    expect(kinds).toEqual(['decline']);
  });

  it('offers accept AND decline when the responder holds the requested receive', () => {
    const base = stateWith({ trade: OPEN_OFFER });
    const state = withResources(base, 1 as Seat, { brick: 0, lumber: 0, wool: 0, grain: 0, ore: 2 });
    const responses = enumerateCandidates(state, 1 as Seat)
      .filter((a) => a.type === 'respondTrade')
      .map((a) => a.response)
      .sort();
    expect(responses).toEqual(['accept', 'decline']);
  });
});
