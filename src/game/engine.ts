/**
 * Pure auction engine.
 *
 * Every function takes a state and returns a new one; nothing is mutated and
 * there is no I/O, which makes the rules easy to test. The Postgres functions
 * in `supabase/migrations` implement exactly the same rules for online play,
 * and `supabase/tests/parity.test.ts` checks the two against each other.
 *
 * Rules in short (see docs/GAME_RULES.md):
 *  - Players alternate as drawer. Only the drawer sees the card.
 *  - The drawer speaks first, then players alternate: bid or pass.
 *  - A pass is final for the current card.
 *  - The card goes to the last bidder standing, who pays their bid.
 *    If nobody bids, the card is discarded.
 */

import { scaleOf } from '../data/characters';
import {
  GameError,
  type GameState,
  type GameView,
  type PlayerState,
  type Seat,
  type Settings,
} from './types';

export const DEFAULT_SETTINGS: Settings = {
  budget: 500,
  teamSize: 5,
  minBid: 10,
  increment: 10,
};

/** How many cards each player may skip in a game (see `Settings.passLimit`). */
export const PASS_LIMIT = 3;

const other = (seat: Seat): Seat => (seat === 0 ? 1 : 0);

/** Fisher–Yates shuffle; `rng` is injectable so tests are deterministic. */
export function shuffle<T>(items: readonly T[], rng: () => number = Math.random): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function validateSettings(settings: Settings, poolSize: number): void {
  const { budget, teamSize, minBid, increment } = settings;
  const ints = [budget, teamSize, minBid, increment].every(Number.isInteger);
  if (
    !ints ||
    teamSize < 1 ||
    teamSize > 10 ||
    minBid < 1 ||
    increment < 1 ||
    budget < minBid ||
    budget > 100_000 ||
    poolSize < teamSize * 2
  ) {
    throw new GameError('INVALID_INPUT');
  }
}

export interface CreateGameOptions {
  settings: Settings;
  names: [string, string];
  /** Character ids to deal from. */
  pool: readonly string[];
  rng?: () => number;
  /** Fixed deck order and first drawer, used by tests. */
  deck?: readonly string[];
  firstDrawer?: Seat;
}

export function createGame(options: CreateGameOptions): GameState {
  const { settings, names, pool, rng = Math.random } = options;
  validateSettings(settings, pool.length);
  // Every card of the chosen universe (or of all of them) is in the deck.
  const deck = options.deck?.slice() ?? shuffle(pool, rng);
  const drawer: Seat = options.firstDrawer ?? (rng() < 0.5 ? 0 : 1);
  const player = (name: string): PlayerState => ({ name, budget: settings.budget, team: [], passes: 0 });
  return {
    settings: { ...settings, passLimit: settings.passLimit ?? PASS_LIMIT },
    scale: scaleOf(pool),
    players: [player(names[0]), player(names[1])],
    deck,
    phase: 'draw',
    round: 1,
    drawer,
    turn: drawer,
    card: null,
    highBid: 0,
    highBidder: null,
    passed: [false, false],
    history: [],
  };
}

/** The smallest amount the next bid must reach. */
export function requiredBid(state: Pick<GameState, 'settings' | 'highBid' | 'highBidder'>): number {
  return state.highBidder === null
    ? state.settings.minBid
    : state.highBid + state.settings.increment;
}

/** Enough of a state or a view to tell what a seat can still do. */
type Holdings = { settings: GameState['settings']; players: ReadonlyArray<GameState['players'][number]> };

export function isTeamFull(state: Holdings, seat: Seat): boolean {
  return state.players[seat].team.length >= state.settings.teamSize;
}

/** How many more cards this seat may skip. */
export function passesLeft(state: Holdings, seat: Seat): number {
  const limit = state.settings.passLimit ?? PASS_LIMIT;
  return Math.max(0, limit - (state.players[seat].passes ?? 0));
}

/**
 * Passing skips the card, and costs one of the player's passes, while nobody
 * has bid on it. Once the other player has bid, passing lets them have it,
 * which is always allowed.
 */
export function passCosts(state: Pick<GameState, 'highBidder'>): boolean {
  return state.highBidder === null;
}

/** False when this seat would have to skip a card and has no passes left: it must bid. */
export function canPass(state: Holdings & Pick<GameState, 'highBidder'>, seat: Seat): boolean {
  return !passCosts(state) || passesLeft(state, seat) > 0;
}

export function canBid(state: GameState, seat: Seat): boolean {
  return !isTeamFull(state, seat) && state.players[seat].budget >= requiredBid(state);
}

/** True when no further card can be sold. */
export function isGameOver(state: GameState): boolean {
  const seats: Seat[] = [0, 1];
  const someoneCanStillBuy = seats.some(
    (s) => !isTeamFull(state, s) && state.players[s].budget >= state.settings.minBid,
  );
  return state.deck.length === 0 || !someoneCanStillBuy;
}

function clone(state: GameState): GameState {
  return {
    ...state,
    settings: { ...state.settings },
    players: [
      { ...state.players[0], team: state.players[0].team.slice() },
      { ...state.players[1], team: state.players[1].team.slice() },
    ],
    deck: state.deck.slice(),
    passed: [state.passed[0], state.passed[1]],
    history: state.history.slice(),
  };
}

/**
 * Advances the bidding as far as it can go without player input:
 * skips players who passed or cannot afford the next bid, and resolves the
 * card once only one bidder (or none) is left. Mutates its argument, which
 * is always a fresh clone.
 */
function settle(s: GameState): GameState {
  for (;;) {
    if (s.highBidder !== null && s.passed[other(s.highBidder)]) {
      const winner = s.highBidder;
      s.players[winner].budget -= s.highBid;
      s.players[winner].team.push(s.card!);
      s.history.push({ round: s.round, card: s.card!, winner, price: s.highBid });
      s.phase = 'reveal';
      return s;
    }
    if (s.passed[0] && s.passed[1]) {
      s.history.push({ round: s.round, card: s.card!, winner: null, price: 0 });
      s.phase = 'reveal';
      return s;
    }
    if (s.passed[s.turn]) {
      s.turn = other(s.turn);
      continue;
    }
    if (!canBid(s, s.turn)) {
      s.passed[s.turn] = true;
      s.turn = other(s.turn);
      continue;
    }
    return s;
  }
}

/** The drawer takes the top card of the deck and bidding opens. */
export function draw(state: GameState, seat: Seat): GameState {
  if (state.phase !== 'draw') throw new GameError('WRONG_PHASE');
  if (seat !== state.drawer) throw new GameError('NOT_YOUR_TURN');
  const s = clone(state);
  s.card = s.deck.shift()!;
  s.phase = 'bidding';
  s.turn = s.drawer;
  s.highBid = 0;
  s.highBidder = null;
  s.passed = [false, false];
  return settle(s);
}

export function bid(state: GameState, seat: Seat, amount: number): GameState {
  if (state.phase !== 'bidding') throw new GameError('WRONG_PHASE');
  if (seat !== state.turn) throw new GameError('NOT_YOUR_TURN');
  if (isTeamFull(state, seat)) throw new GameError('TEAM_FULL');
  if (
    !Number.isInteger(amount) ||
    amount < requiredBid(state) ||
    amount > state.players[seat].budget
  ) {
    throw new GameError('INVALID_BID');
  }
  const s = clone(state);
  s.highBid = amount;
  s.highBidder = seat;
  s.turn = other(seat);
  return settle(s);
}

export function pass(state: GameState, seat: Seat): GameState {
  if (state.phase !== 'bidding') throw new GameError('WRONG_PHASE');
  if (seat !== state.turn) throw new GameError('NOT_YOUR_TURN');
  if (!canPass(state, seat)) throw new GameError('NO_PASSES_LEFT');
  const s = clone(state);
  if (passCosts(s)) s.players[seat].passes = (s.players[seat].passes ?? 0) + 1;
  s.passed[seat] = true;
  s.turn = other(seat);
  return settle(s);
}

/** Leaves the reveal screen: starts the next round or ends the game. */
export function next(state: GameState): GameState {
  if (state.phase !== 'reveal') throw new GameError('WRONG_PHASE');
  const s = clone(state);
  s.card = null;
  s.highBid = 0;
  s.highBidder = null;
  s.passed = [false, false];
  if (isGameOver(s)) {
    s.phase = 'finished';
    return s;
  }
  s.round += 1;
  s.drawer = other(s.drawer);
  s.turn = s.drawer;
  s.phase = 'draw';
  // A drawer who can no longer buy anything would only hold the other player
  // up: the card is drawn for them and bidding opens at once.
  if (!canStillBuy(s, s.drawer)) return draw(s, s.drawer);
  return s;
}

/** True while this seat has room in its team and money for the minimum bid. */
export function canStillBuy(state: Holdings, seat: Seat): boolean {
  return !isTeamFull(state, seat) && state.players[seat].budget >= state.settings.minBid;
}

/**
 * Projects the full state to what a viewer may see.
 *
 * - a seat: the card is visible only to the drawer while bidding (online rule)
 * - `'all'`: nothing is hidden (same-device mode hides the card in the UI)
 */
export function toView(
  state: GameState,
  viewer: Seat | 'all',
  meta: { code?: string | null; version?: number; poolSize?: number } = {},
): GameView {
  const revealed = state.phase === 'reveal';
  const drawerPeek = state.phase === 'bidding' && (viewer === 'all' || viewer === state.drawer);
  return {
    code: meta.code ?? null,
    status: state.phase === 'finished' ? 'finished' : 'playing',
    version: meta.version ?? 0,
    you: viewer === 'all' ? null : viewer,
    settings: { ...state.settings, passLimit: state.settings.passLimit ?? PASS_LIMIT, poolSize: meta.poolSize ?? 0 },
    players: [
      { seat: 0, ...state.players[0], passes: state.players[0].passes ?? 0, team: state.players[0].team.slice() },
      { seat: 1, ...state.players[1], passes: state.players[1].passes ?? 0, team: state.players[1].team.slice() },
    ],
    phase: state.phase,
    round: state.round,
    drawer: state.drawer,
    turn: state.turn,
    highBid: state.highBid,
    highBidder: state.highBidder,
    passed: [state.passed[0], state.passed[1]],
    scale: state.scale ?? 'all',
    deckCount: state.deck.length,
    card: revealed || drawerPeek ? state.card : null,
    history: state.history.slice(),
  };
}
