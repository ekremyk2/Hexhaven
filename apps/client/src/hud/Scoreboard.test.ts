// T-603 requirement 3: the in-game scoreboard re-flows to seat SIX without dropping any per-player
// information. Rendered as static markup (this workspace's `node`-env convention — no jsdom) against
// a crafted 6-player PlayerView. Seat names arrive as a prop, but the rail-redesign turn indicator +
// folded-in C&K improvement column route through `t()`, so a real (test-bootstrapped) i18next
// instance is required — see `initTestI18n`.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { PlayerView } from '@hexhaven/engine';
import type { Seat } from '@hexhaven/shared';
import { Scoreboard } from './Scoreboard';
import { makeAwards, makeOtherPlayerView, makeOwnPlayerView } from './testFixtures';
import { initTestI18n } from './testI18n';

beforeAll(async () => {
  await initTestI18n();
});

const ME = 0 as Seat;

/** A 6-player view: seat 0 is the viewer (full hand), seats 1–5 are redacted opponents with
 * distinct counts so a dropped/duplicated row is visible in the assertions. */
function sixPlayerView(): PlayerView {
  const players = [
    makeOwnPlayerView(0 as Seat, {
      resources: { brick: 1, lumber: 2, wool: 0, grain: 0, ore: 0 },
      playedKnights: 1,
    }),
    makeOtherPlayerView(1 as Seat, { resourceCount: 4, devCardCount: 1, playedKnights: 0 }),
    makeOtherPlayerView(2 as Seat, { resourceCount: 5, devCardCount: 2, playedKnights: 2 }),
    makeOtherPlayerView(3 as Seat, { resourceCount: 6, devCardCount: 0, playedKnights: 1 }),
    makeOtherPlayerView(4 as Seat, { resourceCount: 7, devCardCount: 3, playedKnights: 0 }),
    makeOtherPlayerView(5 as Seat, { resourceCount: 8, devCardCount: 1, playedKnights: 3 }),
  ];
  return {
    v: 1,
    me: ME,
    config: { targetVp: 10 },
    players,
    turn: { number: 12, player: 4 as Seat },
    awards: makeAwards({ longestRoad: { holder: 5 as Seat, length: 6 } }),
  } as unknown as PlayerView;
}

function render() {
  return renderToStaticMarkup(
    createElement(Scoreboard, {
      view: sixPlayerView(),
      me: ME,
      seatName: (s: Seat) => `Player ${s + 1}`,
      presence: {},
      discardAmountFor: () => undefined,
    }),
  );
}

describe('Scoreboard at 6 players (RK-17 re-flow)', () => {
  it('renders one row per seat, all six seats 0–5', () => {
    const html = render();
    for (let seat = 0; seat <= 5; seat++) {
      expect(html, `missing scoreboard row for seat ${seat}`).toContain(`data-testid="scoreboard-seat-${seat}"`);
    }
  });

  it('shows every seat name (no seat silently dropped)', () => {
    const html = render();
    for (let seat = 0; seat <= 5; seat++) {
      expect(html).toContain(`Player ${seat + 1}`);
    }
  });

  it('shows each opponent resource count and VP/target — no truncated info', () => {
    const html = render();
    // The distinct opponent resource counts 4..8 all appear.
    for (const count of [4, 5, 6, 7, 8]) expect(html).toContain(`>${count}<`);
    // VP is rendered against the target for every seat.
    expect(html).toContain('/10');
  });

  it('shows the compact turn indicator (rail redesign: replaces the removed DicePanel turn line)', () => {
    const html = render();
    expect(html).toContain('data-testid="scoreboard-turn-indicator"');
    expect(html).toContain('Turn 12');
    expect(html).toContain('Player 5'); // seat 4 (0-indexed) is the turn player
  });

  it('marks the current turn seat and the longest-road holder', () => {
    const html = render();
    // Current turn (seat 4) row carries the highlight class.
    expect(html).toMatch(/data-testid="scoreboard-seat-4"[^>]*bg-accent-gold/);
    // Longest-road holder (seat 5) gets the road glyph in its row.
    expect(html).toContain('🛣️');
  });
});

describe('Scoreboard Seafarers island chits (T-704)', () => {
  /** A 4-player Seafarers view: seat 0 has one small-island chit (+2 VP, S10.6), others none. */
  function chitView(): PlayerView {
    const players = [
      makeOwnPlayerView(0 as Seat),
      makeOtherPlayerView(1 as Seat),
      makeOtherPlayerView(2 as Seat),
      makeOtherPlayerView(3 as Seat),
    ];
    return {
      v: 1,
      me: ME,
      config: {
        targetVp: 14,
        playerCount: 4,
        expansions: { fiveSix: false, seafarers: { scenario: 'headingForNewShores' }, citiesKnights: false },
      },
      players,
      turn: { number: 1, player: 0 as Seat },
      awards: makeAwards(),
      ext: { seafarers: { islandChits: [[0], [], [], []] } },
    } as unknown as PlayerView;
  }

  function renderChits() {
    return renderToStaticMarkup(
      createElement(Scoreboard, {
        view: chitView(),
        me: ME,
        seatName: (s: Seat) => `Player ${s + 1}`,
        presence: {},
        discardAmountFor: () => undefined,
      }),
    );
  }

  it('folds the +2 chit into the seat total and shows a chit badge', () => {
    const html = renderChits();
    // Seat 0: no pieces, one chit → 0 + 2 = 2 VP toward the scenario target of 14.
    expect(html).toContain('2/14');
    expect(html).toContain('⛵+2');
    // Seats without chits show the plain 0/14 and no badge.
    expect(html).toContain('0/14');
  });
});

describe('Scoreboard Cities & Knights improvement column (rail redesign requirement 4)', () => {
  /** A 4-player C&K view: seat 0 (viewer) is the only one to hold any improvement levels — the
   * OTHER seats' levels must still show up in the table (folded in from the removed per-seat HUD
   * blocks), and absent for a non-C&K game. */
  function ckView(): PlayerView {
    const players = [makeOwnPlayerView(0 as Seat), makeOtherPlayerView(1 as Seat)];
    return {
      v: 1,
      me: ME,
      config: {
        targetVp: 13,
        playerCount: 2,
        expansions: { fiveSix: false, seafarers: false, citiesKnights: true },
      },
      players,
      turn: { number: 3, player: 0 as Seat },
      awards: makeAwards(),
      ext: {
        citiesKnights: {
          improvements: [
            { trade: 2, politics: 0, science: 1 },
            { trade: 0, politics: 0, science: 0 },
          ],
          // A real redacted C&K view always carries these (createGame seeds them) — `computeExtraVp`
          // reads them for the metropolis/defender/merchant VP the engine folds in (B-38).
          metropolis: { trade: null, politics: null, science: null },
          defenderVp: [0, 0],
          merchant: null,
        },
      },
    } as unknown as PlayerView;
  }

  function renderCk() {
    return renderToStaticMarkup(
      createElement(Scoreboard, {
        view: ckView(),
        me: ME,
        seatName: (s: Seat) => `Player ${s + 1}`,
        presence: {},
        discardAmountFor: () => undefined,
      }),
    );
  }

  it('shows a per-seat improvement-track column when the game is Cities & Knights', () => {
    const html = renderCk();
    expect(html).toContain('data-testid="scoreboard-ck-0"');
    expect(html).toContain('data-testid="scoreboard-ck-1"');
  });

  it('omits the column entirely for a non-C&K game', () => {
    const html = render(); // the base 6-player view from above has no `ext.citiesKnights`
    expect(html).not.toContain('scoreboard-ck-');
  });
});

describe('Scoreboard Explorers & Pirates mission point tracks (T-1155)', () => {
  /** A 4-player E&P view for `scenario`, with seat 0 holding every mission tally and seat 1 holding
   *  none — proves both "shows the right value" and "the other seat's zero still renders the track
   *  (mission-gated, not value-gated)". `harborSettlements` gives seat 0 one harbor settlement (the
   *  UNCONDITIONAL VP, EP4.2) so it folds into the total regardless of scenario. */
  function epView(
    scenario: string,
    overrides: Partial<{
      fishPoints: number[];
      spicePoints: number[];
      lairPoints: number[];
      goldPoints: number[];
      spiceBenefit: number[];
      harborSettlements: number[][];
    }> = {},
  ): PlayerView {
    const players = [makeOwnPlayerView(0 as Seat), makeOtherPlayerView(1 as Seat), makeOtherPlayerView(2 as Seat), makeOtherPlayerView(3 as Seat)];
    return {
      v: 1,
      me: ME,
      config: { targetVp: 12, playerCount: 4, expansions: { fiveSix: false, seafarers: false, citiesKnights: false } },
      players,
      turn: { number: 1, player: 0 as Seat },
      awards: makeAwards(),
      ext: {
        explorersPirates: {
          scenario,
          fishPoints: overrides.fishPoints ?? [0, 0, 0, 0],
          spicePoints: overrides.spicePoints ?? [0, 0, 0, 0],
          lairPoints: overrides.lairPoints ?? [0, 0, 0, 0],
          goldPoints: overrides.goldPoints ?? [0, 0, 0, 0],
          spiceBenefit: overrides.spiceBenefit ?? [0, 0, 0, 0],
          harborSettlements: overrides.harborSettlements ?? [[], [], [], []],
        },
      },
    } as unknown as PlayerView;
  }

  function renderEp(view: PlayerView) {
    return renderToStaticMarkup(
      createElement(Scoreboard, {
        view,
        me: ME,
        seatName: (s: Seat) => `Player ${s + 1}`,
        presence: {},
        discardAmountFor: () => undefined,
      }),
    );
  }

  it('Land Ho!: no mission track shows (no missions at all)', () => {
    const html = renderEp(epView('landHo'));
    expect(html).not.toContain('scoreboard-ep-fish-');
    expect(html).not.toContain('scoreboard-ep-spice-');
    expect(html).not.toContain('scoreboard-ep-lair-');
    expect(html).not.toContain('scoreboard-ep-gold-');
  });

  it('Fish for Hexhaven: only the fish (+ gold, "any mission") track shows, with the right value', () => {
    const html = renderEp(epView('fishForHexhaven', { fishPoints: [3, 0, 0, 0] }));
    expect(html).toContain('data-testid="scoreboard-ep-fish-0"');
    expect(html).toContain('🐟+3');
    // Seat 1 has 0 fish points but the mission is active, so the track still renders for that seat.
    expect(html).toContain('data-testid="scoreboard-ep-fish-1"');
    expect(html).toContain('🐟+0');
    // shipGold has no mission of its own — it rides on "any mission active" (epHelpers), so it shows
    // here too even though this scenario is "fish", not "gold".
    expect(html).toContain('data-testid="scoreboard-ep-gold-0"');
    // Spice/lair missions are off in this scenario.
    expect(html).not.toContain('scoreboard-ep-spice-');
    expect(html).not.toContain('scoreboard-ep-lair-');
  });

  it('Spices for Hexhaven: the spice track shows its VP + spice-benefit range level', () => {
    const html = renderEp(epView('spicesForHexhaven', { spicePoints: [2, 0, 0, 0], spiceBenefit: [1, 0, 0, 0] }));
    expect(html).toContain('data-testid="scoreboard-ep-spice-0"');
    expect(html).toContain('🌶️+2 L1');
    expect(html).not.toContain('scoreboard-ep-fish-');
  });

  it('The Pirate Lairs: the lair track shows + the compact captured-lair status line', () => {
    // 3 total lairPoints across seats = exactly one captured lair (LAIR_CAPTURE_CREWS=3, LAIR_CREW_VP=1).
    const html = renderEp(epView('pirateLairs', { lairPoints: [2, 1, 0, 0] }));
    expect(html).toContain('data-testid="scoreboard-ep-lair-0"');
    expect(html).toContain('🏴‍☠️+2');
    expect(html).toContain('data-testid="scoreboard-ep-lairs-captured"');
    expect(html).toContain('1 pirate lair captured so far');
  });

  it('the full campaign: every mission track is on at once', () => {
    const html = renderEp(
      epView('fullCampaign', {
        fishPoints: [1, 0, 0, 0],
        spicePoints: [1, 0, 0, 0],
        lairPoints: [1, 0, 0, 0],
        goldPoints: [1, 0, 0, 0],
      }),
    );
    expect(html).toContain('scoreboard-ep-fish-0');
    expect(html).toContain('scoreboard-ep-spice-0');
    expect(html).toContain('scoreboard-ep-lair-0');
    expect(html).toContain('scoreboard-ep-gold-0');
  });

  it('folds every mission VP + the unconditional harbor-settlement VP into the seat total', () => {
    const html = renderEp(
      epView('fullCampaign', {
        fishPoints: [1, 0, 0, 0],
        spicePoints: [2, 0, 0, 0],
        lairPoints: [1, 0, 0, 0],
        goldPoints: [1, 0, 0, 0],
        harborSettlements: [[10], [], [], []],
      }),
    );
    // Seat 0: no settlements/cities, 1+2+1+1 mission VP + 1 harbor settlement × 2 VP = 7.
    expect(html).toContain('7/12');
    expect(html).toContain('scoreboard-ep-harbor-0');
    expect(html).toContain('🏘️+2');
  });

  it('harbor-settlement VP folds in for Land Ho! too (not mission-gated)', () => {
    const html = renderEp(epView('landHo', { harborSettlements: [[10], [], [], []] }));
    expect(html).toContain('2/12');
    expect(html).toContain('scoreboard-ep-harbor-0');
  });
});
