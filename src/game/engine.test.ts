import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SETTINGS,
  bid,
  canBid,
  createGame,
  draw,
  isGameOver,
  next,
  pass,
  requiredBid,
  shuffle,
  toView,
} from './engine';
import { seeded } from './testing';
import { GameError, type GameState, type Seat, type Settings } from './types';

const pool = Array.from({ length: 24 }, (_, i) => `c${i + 1}`);

function game(overrides: Partial<Settings> = {}, firstDrawer: Seat = 0): GameState {
  return createGame({
    settings: { ...DEFAULT_SETTINGS, ...overrides },
    names: ['Ana', 'Ben'],
    pool,
    deck: pool,
    firstDrawer,
  });
}

function expectError(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(GameError);
    expect((e as GameError).code).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('setup', () => {
  it('deals teamSize × 4 cards and gives both players the full budget', () => {
    const g = createGame({
      settings: DEFAULT_SETTINGS,
      names: ['Ana', 'Ben'],
      pool,
      rng: seeded(1),
    });
    expect(g.deck).toHaveLength(20);
    expect(new Set(g.deck).size).toBe(20);
    expect(g.players.map((p) => p.budget)).toEqual([500, 500]);
    expect(g.phase).toBe('draw');
    expect(g.turn).toBe(g.drawer);
  });

  it('rejects a pool too small for two teams and nonsense settings', () => {
    expectError(
      () => createGame({ settings: DEFAULT_SETTINGS, names: ['a', 'b'], pool: pool.slice(0, 9) }),
      'INVALID_INPUT',
    );
    expectError(
      () => createGame({ settings: { ...DEFAULT_SETTINGS, minBid: 0 }, names: ['a', 'b'], pool }),
      'INVALID_INPUT',
    );
    expectError(
      () => createGame({ settings: { ...DEFAULT_SETTINGS, budget: 5 }, names: ['a', 'b'], pool }),
      'INVALID_INPUT',
    );
  });

  it('shuffle keeps every item exactly once', () => {
    const out = shuffle(pool, seeded(7));
    expect(out.slice().sort()).toEqual(pool.slice().sort());
    expect(out).not.toEqual(pool);
  });
});

describe('drawing', () => {
  it('only the drawer may draw, and only in the draw phase', () => {
    const g = game();
    expectError(() => draw(g, 1), 'NOT_YOUR_TURN');
    const g2 = draw(g, 0);
    expect(g2.card).toBe('c1');
    expect(g2.deck).toHaveLength(23);
    expect(g2.phase).toBe('bidding');
    expect(g2.turn).toBe(0);
    expectError(() => draw(g2, 0), 'WRONG_PHASE');
  });

  it('does not mutate the previous state', () => {
    const g = game();
    const snapshot = JSON.stringify(g);
    draw(g, 0);
    expect(JSON.stringify(g)).toBe(snapshot);
  });
});

describe('bidding', () => {
  it('enforces turn order, the minimum bid, the raise step and the budget', () => {
    let g = draw(game(), 0);
    expectError(() => bid(g, 1, 50), 'NOT_YOUR_TURN');
    expectError(() => bid(g, 0, 5), 'INVALID_BID');
    expectError(() => bid(g, 0, 501), 'INVALID_BID');
    expectError(() => bid(g, 0, 20.5), 'INVALID_BID');
    g = bid(g, 0, 50);
    expect(g.turn).toBe(1);
    expect(requiredBid(g)).toBe(60);
    expectError(() => bid(g, 1, 55), 'INVALID_BID');
    g = bid(g, 1, 60);
    expect(g.highBidder).toBe(1);
    expect(g.turn).toBe(0);
  });

  it('gives the card to the last bidder when the rival passes', () => {
    let g = draw(game(), 0);
    g = bid(g, 0, 50);
    g = bid(g, 1, 120);
    g = pass(g, 0);
    expect(g.phase).toBe('reveal');
    expect(g.players[1].team).toEqual(['c1']);
    expect(g.players[1].budget).toBe(380);
    expect(g.players[0].budget).toBe(500);
    expect(g.history).toEqual([{ round: 1, card: 'c1', winner: 1, price: 120 }]);
  });

  it('lets the rival take the card at their price when the drawer passes first', () => {
    let g = draw(game(), 0);
    g = pass(g, 0);
    expect(g.phase).toBe('bidding');
    expect(g.turn).toBe(1);
    g = bid(g, 1, 10);
    expect(g.phase).toBe('reveal');
    expect(g.players[1].team).toEqual(['c1']);
    expect(g.players[1].budget).toBe(490);
  });

  it('discards the card when both players pass', () => {
    let g = draw(game(), 0);
    g = pass(g, 0);
    g = pass(g, 1);
    expect(g.phase).toBe('reveal');
    expect(g.history[0]).toEqual({ round: 1, card: 'c1', winner: null, price: 0 });
    expect(g.players.map((p) => p.team.length)).toEqual([0, 0]);
  });

  it('resolves at once when the rival cannot afford the next raise', () => {
    let g = draw(game({ budget: 100 }), 0);
    g = bid(g, 0, 100);
    // Ben would need 110 but only has 100: he is skipped automatically.
    expect(g.phase).toBe('reveal');
    expect(g.players[0].team).toEqual(['c1']);
    expect(g.players[0].budget).toBe(0);
  });

  it('skips a player whose team is full', () => {
    let g = game({ teamSize: 1 });
    g = draw(g, 0);
    g = bid(g, 0, 10);
    g = pass(g, 1);
    g = next(g);
    // Ana's team is full. Ben draws round 2 and Ana can no longer bid.
    expect(g.drawer).toBe(1);
    g = draw(g, 1);
    expect(canBid(g, 0)).toBe(false);
    g = bid(g, 1, 10);
    expect(g.phase).toBe('reveal');
    expect(g.players[1].team).toEqual(['c2']);
  });

  it('opens with the rival when the drawer cannot bid', () => {
    let g = game({ teamSize: 1 }, 1);
    g = draw(g, 1);
    g = bid(g, 1, 10);
    g = pass(g, 0);
    g = next(g); // Ben is full; Ana draws
    g = draw(g, 0);
    g = pass(g, 0); // Ana passes; Ben is full → discard
    expect(g.phase).toBe('reveal');
    expect(g.history[1].winner).toBeNull();
    g = next(g); // Ben is full: his card is drawn for him and Ana speaks first
    expect(g.drawer).toBe(1);
    expect(g.phase).toBe('bidding');
    expect(g.card).not.toBeNull();
    expect(g.turn).toBe(0);
    expect(g.passed).toEqual([false, true]);
  });

  it('never makes the player who can still buy wait for one who cannot', () => {
    let g = game({ teamSize: 1 }, 1);
    g = draw(g, 1);
    g = bid(g, 1, 10);
    g = pass(g, 0); // Ben is full
    for (let round = 0; round < 6 && g.phase !== 'finished'; round++) {
      g = next(g);
      if (g.phase === 'finished') break;
      // Whenever play reaches a decision, it is Ana's.
      if (g.phase === 'draw') expect(g.drawer).toBe(0);
      else expect(g.turn).toBe(0);
      g = g.phase === 'draw' ? pass(draw(g, 0), 0) : pass(g, 0);
    }
  });
});

describe('rounds and end of game', () => {
  it('alternates the drawer every round', () => {
    let g = draw(game(), 0);
    g = pass(pass(g, 0), 1);
    expectError(() => pass(g, 0), 'WRONG_PHASE');
    g = next(g);
    expect(g.round).toBe(2);
    expect(g.drawer).toBe(1);
    expect(g.turn).toBe(1);
    expect(g.phase).toBe('draw');
    expect(g.card).toBeNull();
    expectError(() => next(g), 'WRONG_PHASE');
  });

  it('ends when both teams are full', () => {
    let g = game({ teamSize: 1 });
    g = pass(bid(draw(g, 0), 0, 10), 1);
    g = next(g);
    g = bid(draw(g, 1), 1, 10);
    expect(g.phase).toBe('reveal');
    g = next(g);
    expect(g.phase).toBe('finished');
    expect(isGameOver(g)).toBe(true);
  });

  it('ends when the deck runs out', () => {
    let g = createGame({
      settings: { ...DEFAULT_SETTINGS, teamSize: 1 },
      names: ['Ana', 'Ben'],
      pool,
      deck: ['only'],
      firstDrawer: 0,
    });
    g = pass(pass(draw(g, 0), 0), 1);
    g = next(g);
    expect(g.phase).toBe('finished');
  });

  it('ends when nobody can afford the minimum bid any more', () => {
    let g = game({ budget: 10, teamSize: 3 });
    g = bid(draw(g, 0), 0, 10); // Ana is broke; Ben cannot raise to 20
    g = next(g);
    g = bid(draw(g, 1), 1, 10); // Ana is skipped, Ben is broke
    g = next(g);
    expect(g.phase).toBe('finished');
  });
});

describe('views', () => {
  it('shows the card only to the drawer while bidding, then to everyone', () => {
    let g = draw(game(), 0);
    expect(toView(g, 0).card).toBe('c1');
    expect(toView(g, 1).card).toBeNull();
    expect(toView(g, 'all').card).toBe('c1');
    g = pass(pass(g, 0), 1);
    expect(toView(g, 1).card).toBe('c1');
    g = next(g);
    expect(toView(g, 0).card).toBeNull();
  });

  it('never leaks the deck', () => {
    const view = toView(draw(game(), 0), 1);
    expect(JSON.stringify(view)).not.toContain('c2');
    expect(view.deckCount).toBe(23);
  });
});

describe('random playthroughs keep the books balanced', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('seed %i', (seed) => {
    const rng = seeded(seed);
    let g = createGame({
      settings: { budget: 300, teamSize: 4, minBid: 10, increment: 10 },
      names: ['Ana', 'Ben'],
      pool,
      rng,
    });
    let steps = 0;
    while (g.phase !== 'finished') {
      if (++steps > 2000) throw new Error('game did not terminate');
      if (g.phase === 'draw') g = draw(g, g.drawer);
      else if (g.phase === 'reveal') g = next(g);
      else if (rng() < 0.6) {
        const min = requiredBid(g);
        const max = g.players[g.turn].budget;
        g = bid(g, g.turn, Math.min(max, min + Math.floor(rng() * 6) * 10));
      } else g = pass(g, g.turn);

      for (const seat of [0, 1] as Seat[]) {
        const p = g.players[seat];
        const spent = g.history
          .filter((h) => h.winner === seat)
          .reduce((sum, h) => sum + h.price, 0);
        expect(p.budget).toBeGreaterThanOrEqual(0);
        expect(p.budget + spent).toBe(300);
        expect(p.team.length).toBeLessThanOrEqual(4);
      }
    }
    const seen = [...g.players[0].team, ...g.players[1].team];
    expect(new Set(seen).size).toBe(seen.length);
  });
});
