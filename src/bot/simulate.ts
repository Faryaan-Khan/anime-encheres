/**
 * Plays whole games between two automatic players. Used by the tests to
 * check that the bots always play legal moves and to measure how strong
 * they are. Not imported by the app.
 */
import { getCharacter } from '../data/characters';
import { bid, canPass, createGame, draw, next, pass, requiredBid, toView } from '../game/engine';
import type { GameState, Seat, Settings } from '../game/types';
import { judge, type Verdict } from '../game/verdict';
import {
  decide,
  decideByRules,
  emptyMemory,
  observe,
  type BotAction,
  type BotLevel,
  type BotMemory,
  type Style,
} from './bot';

/**
 * Baselines to measure the bots against. `random` bids at random. `honest`
 * is a naive but sensible player: it pays more for better-ranked cards,
 * splits its budget evenly across its open slots and never bluffs.
 */
export type Player = BotLevel | 'random' | 'honest' | Style | { lookahead: true; rollouts: number; playout: Style; instinct: Style };

export interface SimulationResult {
  state: GameState;
  verdict: Verdict;
  steps: number;
}

function baseline(kind: 'random' | 'honest', state: GameState, seat: Seat, pool: readonly string[], rng: () => number): BotAction {
  const view = toView(state, seat);
  if (view.phase === 'draw') return { type: 'draw' };
  const required = requiredBid(state);
  const self = state.players[seat];
  if (kind === 'random') {
    if (rng() < 0.45) return { type: 'pass' };
    const extra = Math.floor(rng() * 4) * state.settings.increment;
    return { type: 'bid', amount: Math.min(self.budget, required + extra) };
  }
  const powers = pool.map((id) => getCharacter(id).power);
  const slots = state.settings.teamSize - self.team.length;
  // Rank of the card in the pool, from 0 to 1, scaled to 0.1–2.5 fair shares.
  const value = (power: number) => {
    const rank = powers.filter((other) => other < power).length / powers.length;
    return Math.min(self.budget, (self.budget / Math.max(1, slots)) * (0.1 + 2.4 * rank * rank));
  };
  const limit =
    view.card !== null
      ? value(getCharacter(view.card).power)
      : powers.reduce((sum, power) => sum + value(power), 0) / powers.length;
  return required <= limit ? { type: 'bid', amount: required } : { type: 'pass' };
}

export function simulate(
  players: Player[],
  pool: readonly string[],
  rng: () => number,
  rollouts?: number,
  settings: Settings = { budget: 500, teamSize: 5, minBid: 10, increment: 10 },
): SimulationResult {
  let state = createGame({ settings, names: ['A', 'B'], pool, rng });
  const memory: BotMemory[] = [emptyMemory(), emptyMemory()];
  const watch = () => {
    for (const seat of [0, 1] as Seat[]) {
      memory[seat] = observe(memory[seat], toView(state, seat), pool);
    }
  };
  watch();

  let steps = 0;
  while (state.phase !== 'finished') {
    if (++steps > 5000) throw new Error('game did not terminate');
    if (state.phase === 'reveal') {
      state = next(state);
    } else {
      const seat = state.phase === 'draw' ? state.drawer : state.turn;
      const kind = players[seat];
      let action: BotAction;
      if (kind === 'random' || kind === 'honest') {
        action = baseline(kind, state, seat, pool, rng);
      } else if (typeof kind === 'object' && 'lookahead' in kind) {
        const result = decide(toView(state, seat), {
          pool,
          level: 'hard',
          memory: memory[seat],
          rng,
          rollouts: kind.rollouts,
          playoutStyle: kind.playout,
          instinctStyle: kind.instinct,
        });
        action = result.action;
        memory[seat] = result.memory;
      } else if (typeof kind === 'object') {
        const result = decideByRules(toView(state, seat), { pool, level: 'normal', memory: memory[seat], rng }, kind);
        action = result.action;
        memory[seat] = result.memory;
      } else {
        const result = decide(toView(state, seat), { pool, level: kind, memory: memory[seat], rng, rollouts });
        action = result.action;
        memory[seat] = result.memory;
      }
      // Out of passes and nobody has bid: the only legal move is the minimum bid.
      if (action.type === 'pass' && !canPass(state, seat)) action = { type: 'bid', amount: requiredBid(state) };
      if (action.type === 'draw') state = draw(state, seat);
      else if (action.type === 'pass') state = pass(state, seat);
      else state = bid(state, seat, action.amount);
    }
    watch();
  }

  const powers = (seat: Seat) => state.players[seat].team.map((id) => getCharacter(id).power);
  return { state, verdict: judge(powers(0), powers(1)), steps };
}

/** Share of games won by `a` against `b` over `games` games, swapping seats each game. */
export function winRate(a: Player, b: Player, pool: readonly string[], games: number, rng: () => number, rollouts?: number): number {
  let score = 0;
  for (let i = 0; i < games; i++) {
    const aSeat: Seat = i % 2 === 0 ? 0 : 1;
    const players: [Player, Player] = aSeat === 0 ? [a, b] : [b, a];
    const { verdict } = simulate(players, pool, rng, rollouts);
    if (verdict.winner === null) score += 0.5;
    else if (verdict.winner === aSeat) score += 1;
  }
  return score / games;
}
