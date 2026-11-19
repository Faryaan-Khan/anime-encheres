/**
 * Shared game types.
 *
 * All money amounts are integers expressed in millions (500 = 500M).
 * The same shapes are produced by the in-browser engine (same-device mode)
 * and by the Postgres functions (online mode), so the UI only knows `GameView`.
 */

export type Seat = 0 | 1;

export type Phase = 'lobby' | 'draw' | 'bidding' | 'reveal' | 'finished';

export interface Settings {
  /** Starting budget of each player, in millions. */
  budget: number;
  /** Number of characters each player tries to collect. */
  teamSize: number;
  /** Smallest legal opening bid, in millions. */
  minBid: number;
  /** Smallest legal raise over the current bid, in millions. */
  increment: number;
  /**
   * How many times each player may skip a card: pass when nobody has bid on
   * it yet. Letting the other player have a card they bid on is always free.
   * 3 when missing (games saved before the limit existed).
   */
  passLimit?: number;
}

export interface PlayerState {
  name: string;
  budget: number;
  /** Character ids won so far, in the order they were won. */
  team: string[];
  /** Cards skipped so far (passes that count against `settings.passLimit`). */
  passes?: number;
}

export interface HistoryEntry {
  round: number;
  card: string;
  /** `null` when both players passed and the card was discarded. */
  winner: Seat | null;
  price: number;
}

/** Complete, secret-including state. Never sent to a client in online mode. */
export interface GameState {
  settings: Settings;
  players: [PlayerState, PlayerState];
  /** Remaining cards; index 0 is the top of the deck. */
  deck: string[];
  phase: Exclude<Phase, 'lobby'>;
  round: number;
  /** The player who draws this round and is the only one who sees the card. */
  drawer: Seat;
  /** The player who must act during the bidding phase. */
  turn: Seat;
  card: string | null;
  highBid: number;
  highBidder: Seat | null;
  /** A pass is final for the current card. */
  passed: [boolean, boolean];
  history: HistoryEntry[];
  /**
   * The power scale the game is shown on: a universe id when every card comes
   * from that universe (each universe on its own 0–100 scale), `all` for
   * mixed games. Display only; the winner is decided on shared power. Missing
   * in games saved before scales existed: `all`.
   */
  scale?: string;
}

export interface PlayerView extends PlayerState {
  seat: Seat;
  /** Public rooms: the player's friend tag and picture (null without a profile). */
  tag?: string | null;
  avatar?: string | number | null;
}

/**
 * What one player is allowed to see. `card` is `null` whenever the viewer
 * must not know the current character.
 */
export interface GameView {
  code: string | null;
  status: 'lobby' | 'playing' | 'finished';
  version: number;
  /** Seat of the viewer, or `null` for the shared screen in same-device mode. */
  you: Seat | null;
  settings: Settings & { poolSize: number };
  players: PlayerView[];
  phase: Phase;
  round: number;
  drawer: Seat;
  turn: Seat;
  highBid: number;
  /** See `GameState.scale`. */
  scale?: string;
  highBidder: Seat | null;
  passed: [boolean, boolean];
  deckCount: number;
  card: string | null;
  history: HistoryEntry[];
  /** Online only: the room was created by matchmaking. */
  matched?: boolean;
  /** Online rooms: listed for everyone online to join. */
  public?: boolean;
  /** Online rooms: the universe dealt from, or `mix`. */
  verse?: string;
  /** Online only: the seat that gave up or ran out of time, if any. */
  forfeit?: Seat | null;
  /** Online only: seconds since the last change, as of when this view was read. */
  idle?: number;
  /** Online only: the server's verdict, once the game is over. */
  result?: MatchResult | null;
  /** Quick matches: seconds each move may take. */
  turnSeconds?: number;
  /** Quick matches: times each seat ran out of time (the server then moved for them). */
  strikes?: [number, number];
  /** Quick matches: the time-out that loses the match. */
  maxStrikes?: number;
  /** Quick matches: seconds since each seat's device was last heard from. */
  absent?: [number, number];
  /** Quick matches: a player not heard from for this long has left, and loses. */
  awaySeconds?: number;
}

/** How the server judged a finished online game. */
export interface MatchResult {
  winner: Seat | null;
  /** Ranked games: the mode (a universe id or `mix`) whose trophies moved. */
  mode?: string | null;
  power: [number, number];
  /** Trophy change of each seat; `null` in private rooms. */
  deltas: [number, number] | null;
  /** New trophies of each seat in that mode; an entry is `null` for a seat without a profile. */
  trophies: [number | null, number | null] | null;
}

export type GameErrorCode =
  | 'WRONG_PHASE'
  | 'NOT_YOUR_TURN'
  | 'TEAM_FULL'
  | 'INVALID_BID'
  | 'NO_PASSES_LEFT'
  | 'INVALID_INPUT';

export class GameError extends Error {
  constructor(public readonly code: GameErrorCode) {
    super(code);
    this.name = 'GameError';
  }
}
