import { describe, expect, it } from 'vitest';
import { MIX_ID, poolFor } from '../data/characters';
import { bid, createGame, draw, pass, toView } from '../game/engine';
import { seeded } from '../game/testing';
import type { Seat } from '../game/types';
import { decide, emptyMemory, isBotTurn, learnedBluffRate, marketOf, observe, valuer, styleForSkill } from './bot';
import { simulate, winRate, type Player } from './simulate';

const onePiece = poolFor('one-piece');
const settings = { budget: 500, teamSize: 5, minBid: 10, increment: 10 };

describe('valuation', () => {
  const market = marketOf(onePiece, 19);

  it('pays more for stronger cards and nothing for ones not worth a slot', () => {
    const worth = valuer(500, 5, market);
    expect(worth(55)).toBeGreaterThan(worth(50));
    expect(worth(50)).toBeGreaterThan(worth(45));
    expect(worth(55)).toBeGreaterThan(100);
    expect(worth(4)).toBe(0);
  });

  it('never exceeds the budget and is zero without money or slots', () => {
    expect(valuer(500, 1, marketOf([], 0))(40)).toBe(500);
    expect(valuer(120, 5, market)(58)).toBeLessThanOrEqual(120);
    expect(valuer(0, 5, market)(58)).toBe(0);
    expect(valuer(500, 0, market)(58)).toBe(0);
  });

  it('values a card more when fewer good cards are still to come', () => {
    const rich = marketOf(onePiece, 19);
    const poor = marketOf(onePiece.slice(30), 19);
    expect(valuer(500, 5, poor)(46)).toBeGreaterThan(valuer(500, 5, rich)(46));
  });
});

describe('fair play', () => {
  it('decides the same whatever card the rival is holding', () => {
    for (const level of ['normal', 'hard'] as const) {
      const decisions = ['monkey-d-luffy', 'nefertari-vivi', 'sanji'].map((hidden) => {
        const deck = [hidden, ...onePiece.filter((id) => id !== hidden).slice(0, 19)];
        // Seat 0 draws; the bot in seat 1 must act blind after a 60M opening.
        let state = draw(createGame({ settings, names: ['A', 'B'], pool: onePiece, deck, firstDrawer: 0 }), 0);
        state = { ...state, highBid: 60, highBidder: 0, turn: 1 };
        const view = toView(state, 1);
        expect(view.card).toBeNull();
        expect(isBotTurn(view)).toBe(true);
        return decide(view, { pool: onePiece, level, memory: emptyMemory(), rng: seeded(42), rollouts: 12 }).action;
      });
      expect(decisions[1]).toEqual(decisions[0]);
      expect(decisions[2]).toEqual(decisions[0]);
    }
  });

  it('only acts on its own turn', () => {
    const state = createGame({ settings, names: ['A', 'B'], pool: onePiece, rng: seeded(1), firstDrawer: 0 });
    expect(isBotTurn(toView(state, 1))).toBe(false);
    expect(isBotTurn(toView(state, 0))).toBe(true);
  });
});

describe('memory', () => {
  it('learns how often the rival overbids on cards they drew', () => {
    const fresh = learnedBluffRate(emptyMemory(), 10);
    const honest = { ...emptyMemory(), observations: Array.from({ length: 8 }, () => ({ card: 'x', rivalMaxBid: 50, rivalFair: 120 })) };
    const bluffer = { ...emptyMemory(), observations: Array.from({ length: 8 }, () => ({ card: 'x', rivalMaxBid: 200, rivalFair: 20 })) };
    expect(learnedBluffRate(honest, 10)).toBeLessThan(fresh);
    expect(learnedBluffRate(bluffer, 10)).toBeGreaterThan(fresh);
  });

  it('records the rival’s highest bid once the card is revealed', () => {
    let state = createGame({ settings, names: ['A', 'B'], pool: onePiece, deck: onePiece.slice(0, 20), firstDrawer: 0 });
    let memory = observe(emptyMemory(), toView(state, 1), onePiece);
    state = bid(draw(state, 0), 0, 80);
    memory = observe(memory, toView(state, 1), onePiece);
    expect(memory.rivalMaxBid).toBe(80);
    expect(memory.observations).toHaveLength(0);
    state = pass(state, 1);
    memory = observe(memory, toView(state, 1), onePiece);
    memory = observe(memory, toView(state, 1), onePiece); // seeing the same state twice changes nothing
    expect(memory.observations).toHaveLength(1);
    expect(memory.observations[0]).toMatchObject({ card: onePiece[0], rivalMaxBid: 80 });
    expect(memory.observations[0].rivalFair).toBeGreaterThan(80);
  });
});

describe('whole games', () => {
  const matchups: [Player, Player][] = [
    ['normal', 'normal'],
    ['normal', 'random'],
    ['honest', 'normal'],
    ['hard', 'normal'],
    ['hard', 'hard'],
  ];

  it.each(matchups)('%s against %s always plays legal moves to the end', (a, b) => {
    for (const [universe, seed] of [['demon-slayer', 1], ['one-piece', 2], [MIX_ID, 3]] as const) {
      // An illegal move would throw inside the engine.
      const { state } = simulate([a, b], poolFor(universe), seeded(seed), 6);
      expect(state.phase).toBe('finished');
      for (const seat of [0, 1] as Seat[]) {
        expect(state.players[seat].budget).toBeGreaterThanOrEqual(0);
        expect(state.players[seat].team.length).toBeLessThanOrEqual(5);
      }
    }
  });

  it('survives unusual settings', () => {
    for (const custom of [
      { budget: 300, teamSize: 7, minBid: 10, increment: 10 },
      { budget: 1000, teamSize: 3, minBid: 10, increment: 10 },
      { budget: 30, teamSize: 5, minBid: 10, increment: 10 },
    ]) {
      const { state } = simulate(['hard', 'normal'], poolFor('demon-slayer'), seeded(4), 4, custom);
      expect(state.phase).toBe('finished');
      expect(state.players[0].team.length).toBeLessThanOrEqual(custom.teamSize);
    }
  });
});

describe('strength', () => {
  it('normal clearly beats random and naive players', () => {
    expect(winRate('normal', 'random', onePiece, 400, seeded(21))).toBeGreaterThan(0.65);
    expect(winRate('normal', 'honest', onePiece, 400, seeded(22))).toBeGreaterThan(0.55);
  });

  it('the online opponent gets stronger with its skill setting', () => {
    const [beginner, middle, expert] = [0, 0.5, 1].map(styleForSkill);
    expect(winRate(beginner, 'normal', onePiece, 300, seeded(31))).toBeLessThan(0.42);
    expect(winRate(middle, beginner, onePiece, 300, seeded(32))).toBeGreaterThan(0.58);
    // With three passes per game the expert's caution buys little over the
    // middle style; from skill 0.6 the opponent plays through the look-ahead
    // anyway (Edge Function), so the rule-based top only has to hold its own.
    expect(winRate(expert, middle, onePiece, 300, seeded(33))).toBeGreaterThan(0.45);
    expect(winRate(expert, beginner, onePiece, 300, seeded(34))).toBeGreaterThan(0.62);
  });

  it('hard clearly beats normal', () => {
    expect(winRate('hard', 'normal', onePiece, 60, seeded(23), 16)).toBeGreaterThan(0.6);
  });
});
