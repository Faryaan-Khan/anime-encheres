/**
 * Computer opponent.
 *
 * The bot plays fair: `decide` receives the same filtered `GameView` a human
 * in that seat would get, so it never knows a card its rival drew or the
 * order of the deck. Everything it uses is public: the character pool, the
 * cards already revealed, both budgets and teams, and the bids it has seen.
 *
 *   normal  a rule-based player. It prices each card from its strength,
 *           reads the rival's bids with a simple probability model, bluffs
 *           now and then, and has human-like noise in its judgment.
 *
 *   hard    looks ahead. For each option (bid or pass) it imagines many
 *           ways the hidden information could turn out, each consistent
 *           with everything it has seen, plays every one of those games to
 *           the end, and picks the option that wins more often. It counts
 *           cards exactly and learns how often this rival bluffs.
 *
 * See docs/ARCHITECTURE.md ("Computer opponent") for the reasoning.
 */
import { getCharacter } from '../data/characters';
import { bid, canPass, draw, next, pass, shuffle } from '../game/engine';
import type { GameState, GameView, Seat } from '../game/types';
import { judge, strength } from '../game/verdict';

export type BotLevel = 'normal' | 'hard';

export type BotAction = { type: 'draw' } | { type: 'pass' } | { type: 'bid'; amount: number };

/** One finished round in which the rival drew the card and bid on it. */
interface Observation {
  card: string;
  rivalMaxBid: number;
  /** What the card was honestly worth to the rival at the time. */
  rivalFair: number;
}

/** What the bot remembers between decisions. Plain JSON, saved with the game. */
export interface BotMemory {
  observations: Observation[];
  /** Round the fields below describe. */
  round: number;
  rivalBudget: number;
  rivalSlots: number;
  rivalMaxBid: number;
  /** Decided once per round when the bot draws: is this card a bluff? */
  bluff: boolean | null;
  recorded: boolean;
}

export function emptyMemory(): BotMemory {
  return {
    observations: [],
    round: 0,
    rivalBudget: 0,
    rivalSlots: 0,
    rivalMaxBid: 0,
    bluff: null,
    recorded: false,
  };
}

export interface BotContext {
  /** Every character id that can appear in this game. */
  pool: readonly string[];
  level: BotLevel;
  memory: BotMemory;
  rng?: () => number;
  /** Imagined games per decision for the hard level. More is stronger and slower. */
  rollouts?: number;
  /** How both players play in the imagined games (default: the normal level). */
  playoutStyle?: Style;
  /** What the hard level does when looking ahead cannot separate the options (default: SHARP). */
  instinctStyle?: Style;
}

export interface Decision {
  action: BotAction;
  memory: BotMemory;
}

const rivalOf = (seat: Seat): Seat => (seat === 0 ? 1 : 0);
const powerOf = (id: string): number => getCharacter(id).power;

// ---------------------------------------------------------------------------
// Valuation
// ---------------------------------------------------------------------------

/**
 * The cards that may still come up, as the bot sees them: the strength of
 * every candidate (strongest first) and the chance that any one of them is
 * among the cards left in the deck.
 */
export interface Market {
  strengths: number[];
  presence: number;
}

export function marketOf(candidates: readonly string[], cardsLeft: number): Market {
  const strengths = candidates.map((id) => strength(powerOf(id))).sort((a, b) => b - a);
  return withPresence(strengths, cardsLeft);
}

function withPresence(strengths: number[], cardsLeft: number): Market {
  return { strengths, presence: strengths.length > 0 ? Math.min(1, cardsLeft / strengths.length) : 0 };
}

/** Sorted strengths of a whole pool, computed once per pool. */
const poolStrengths = new WeakMap<readonly string[], number[]>();

function wholePoolMarket(pool: readonly string[], cardsLeft: number): Market {
  let strengths = poolStrengths.get(pool);
  if (!strengths) {
    strengths = pool.map((id) => strength(powerOf(id))).sort((a, b) => b - a);
    poolStrengths.set(pool, strengths);
  }
  return withPresence(strengths, cardsLeft);
}

/** Share of the cards still to come that a player can expect to win. */
const CONTESTED = 0.5;

/**
 * Returns a function giving what a card of some power is worth to a player
 * with this budget and this many open slots.
 *
 * Team power is top-heavy, so money is best spent in proportion to strength:
 * a card gets the share of the budget that its strength represents among
 * everything the player could still hope to add. Weak cards are worth next
 * to nothing, the last card of the game is worth the whole budget, and a
 * card too weak to deserve one of the remaining slots is worth zero.
 */
export function valuer(budget: number, openSlots: number, market: Market): (power: number) => number {
  if (openSlots <= 0 || budget <= 0) return () => 0;
  const reach = market.presence * CONTESTED;

  // Strength of the card that would otherwise fill the last open slot.
  const lastSlotIndex = reach > 0 ? Math.ceil(openSlots / reach) - 1 : Infinity;
  const threshold = lastSlotIndex < market.strengths.length ? market.strengths[lastSlotIndex] : 0;

  // Expected combined strength of the best cards still to come, one per slot.
  let expectedCards = 0;
  let future = 0;
  for (const s of market.strengths) {
    if (expectedCards >= openSlots) break;
    const part = Math.min(market.presence, openSlots - expectedCards);
    expectedCards += part;
    future += part * s;
  }
  const alternatives = CONTESTED * future;

  return (power) => {
    const s = strength(power);
    return s < threshold ? 0 : budget * (s / (s + alternatives));
  };
}

// ---------------------------------------------------------------------------
// Memory
// ---------------------------------------------------------------------------

/**
 * Call with the bot's view after every change of state. Tracks the rival's
 * highest bid of the round and, once the card is revealed, files it as
 * evidence of how honestly the rival bids on cards they have seen.
 */
export function observe(memory: BotMemory, view: GameView, pool: readonly string[]): BotMemory {
  if (view.you === null || (view.phase !== 'bidding' && view.phase !== 'reveal')) return memory;
  const rivalSeat = rivalOf(view.you);
  const rival = view.players[rivalSeat];
  const last = view.history[view.history.length - 1];
  let m = memory;

  if (m.round !== view.round) {
    // A card can be resolved before we see the bidding; undo its payment.
    const rivalWon = view.phase === 'reveal' && last?.winner === rivalSeat;
    m = {
      ...m,
      round: view.round,
      rivalBudget: rival.budget + (rivalWon ? last.price : 0),
      rivalSlots: view.settings.teamSize - rival.team.length + (rivalWon ? 1 : 0),
      rivalMaxBid: 0,
      bluff: null,
      recorded: false,
    };
  }

  if (view.highBidder === rivalSeat && view.highBid > m.rivalMaxBid) {
    m = { ...m, rivalMaxBid: view.highBid };
  }

  if (view.phase === 'reveal' && !m.recorded && last?.round === view.round) {
    m = { ...m, recorded: true };
    if (view.drawer === rivalSeat && m.rivalMaxBid > 0) {
      const market = wholePoolMarket(pool, view.deckCount);
      const rivalFair = valuer(m.rivalBudget, m.rivalSlots, market)(powerOf(last.card));
      m = {
        ...m,
        observations: [...m.observations, { card: last.card, rivalMaxBid: m.rivalMaxBid, rivalFair }],
      };
    }
  }
  return m;
}

/**
 * How often this rival bids well above a card's worth after seeing it.
 * Starts from a neutral guess and moves with the evidence.
 */
export function learnedBluffRate(memory: BotMemory, increment: number): number {
  const bluffs = memory.observations.filter(
    (o) => o.rivalMaxBid > o.rivalFair * 1.4 + increment,
  ).length;
  const rate = (bluffs + 1) / (memory.observations.length + 4);
  return Math.min(0.6, Math.max(0.08, rate));
}

// ---------------------------------------------------------------------------
// What a blind bidder can infer
// ---------------------------------------------------------------------------

/** Chance that a rival who saw the card and could bid passes on one they want. */
const PASS_ON_WANTED = 0.07;
/** Chance that an honest rival raises again while the card is still worth it. */
const RAISES_WHEN_WORTH_IT = 0.85;
/** Chance that a rival raises again although the card is not worth it. */
const RAISES_ANYWAY = 0.3;

/**
 * How likely the rival's behaviour so far is if the hidden card were worth
 * `rivalWorth` to them. The rival knows the card; the bot does not.
 */
function likelihood(view: GameView, rivalWorth: number, bluffRate: number): number {
  const { minBid, teamSize } = view.settings;
  const rivalSeat = rivalOf(view.you as Seat);
  const rival = view.players[rivalSeat];
  if (view.highBidder === rivalSeat) return rivalWorth >= view.highBid ? 1 : bluffRate;
  // No bid from the rival: either they chose to pass, or they could not bid.
  const rivalChose = teamSize - rival.team.length > 0 && rival.budget >= minBid;
  return !rivalChose || rivalWorth < minBid * 2 ? 1 : PASS_ON_WANTED;
}

// ---------------------------------------------------------------------------
// Normal level: rules
// ---------------------------------------------------------------------------

export interface Style {
  /** Count exactly which cards are left, or judge against the whole pool. */
  countsCards: boolean;
  /** Random error in valuations, as a fraction (0.15 = up to ±15%). */
  noise: number;
  /** Chance to bluff after drawing a card it does not want. */
  bluffChance: number;
  /** Open at the minimum on a wanted card instead of part of its worth. */
  opensAtMinimum: boolean;
  /** Assumed chance that the rival is bluffing; `null` to learn it. */
  rivalBluffRate: number | null;
  /** Multiplies what a card it has seen is worth to it (1 = sound, 2 = overpays). */
  greed?: number;
  /** Multiplies what it will pay for a card it has not seen. */
  nerve?: number;
  /** How far a bluff goes, as a share of one slot's fair budget (default 0.5). */
  bluffDepth?: number;
  /** A card counts as unwanted, and can be bluffed on, below this many minimum bids (default 2). */
  bluffBelow?: number;
}

const NORMAL: Style = {
  countsCards: false,
  noise: 0.15,
  bluffChance: 0.15,
  opensAtMinimum: false,
  rivalBluffRate: 0.25,
};

/**
 * The online opponent's style for a skill between 0 (beginner) and 1
 * (expert). The database plays these same rules
 * (supabase/migrations/0005_accounts_and_opponent.sql); they are kept here
 * so that a test can check both make the same decisions, and so that their
 * strength can be measured.
 *
 * A beginner is timid with cards it has seen and reckless with cards it has
 * not, which is the classic mistake in this game. An expert prices what it
 * sees soundly, rarely chases a hidden card, and counts the cards left.
 */
export function styleForSkill(skill: number): Style {
  const s = Math.min(1, Math.max(0, skill));
  return {
    countsCards: s >= 0.7,
    noise: 0.45 - 0.4 * s,
    bluffChance: 0.15,
    opensAtMinimum: false,
    rivalBluffRate: 0.25,
    greed: s >= 0.5 ? 1 : 0.4 + 1.2 * s,
    nerve: s <= 0.5 ? 2.5 - 3.2 * s : 0.9 - 1.2 * (s - 0.5),
  };
}

/** One decision of the rule-based player with an explicit style. */
export function decideByRules(view: GameView, ctx: BotContext, style: Style): Decision {
  return byRules(view, ctx, style, ctx.rng ?? Math.random);
}

/** The hard level's instinct, used when looking ahead cannot separate the options. */
const SHARP: Style = {
  countsCards: true,
  noise: 0,
  bluffChance: 0,
  opensAtMinimum: true,
  rivalBluffRate: null,
};

function byRules(view: GameView, ctx: BotContext, style: Style, rng: () => number): Decision {
  const me = view.you as Seat;
  const rivalSeat = rivalOf(me);
  let memory = ctx.memory;

  if (view.phase === 'draw') return { action: { type: 'draw' }, memory };

  const { minBid, increment, teamSize } = view.settings;
  const self = view.players[me];
  const rival = view.players[rivalSeat];
  const mySlots = teamSize - self.team.length;
  const rivalSlots = teamSize - rival.team.length;
  const required = view.highBidder === null ? minBid : view.highBid + increment;
  const floor = (amount: number) => Math.floor(amount / increment) * increment;
  let passes = (): Decision => ({ action: { type: 'pass' }, memory });
  const bids = (amount: number): Decision => ({ action: { type: 'bid', amount }, memory });

  if (mySlots <= 0 || self.budget < required) return passes();
  // Out of passes and nobody has bid: skipping is not allowed, so wherever the
  // bot would pass it bids the minimum instead. (Same in encheres.bot_choice.)
  if (!canPass(view, me)) passes = () => bids(required);

  const revealed = new Set(view.history.map((h) => h.card));
  const unseen = ctx.pool.filter((id) => !revealed.has(id));
  const market = style.countsCards
    ? marketOf(view.card === null ? unseen : unseen.filter((id) => id !== view.card), view.deckCount)
    : wholePoolMarket(ctx.pool, view.deckCount);
  const myWorth = valuer(self.budget, mySlots, market);
  const rivalIsOut = view.passed[rivalSeat] || rivalSlots <= 0 || rival.budget < minBid;

  // ----- The bot drew the card and knows it --------------------------------
  if (view.card !== null) {
    const noise = 1 + (rng() * 2 - 1) * style.noise;
    const limit = floor(Math.min(self.budget, myWorth(powerOf(view.card)) * noise * (style.greed ?? 1)));
    // A bluff pretends the card is decent: half a slot's fair share at most.
    const bluffCeiling = floor(Math.min(self.budget, (self.budget / mySlots) * (style.bluffDepth ?? 0.5)));

    if (view.highBidder === null) {
      // Nobody to outbid: take it at the minimum or leave it.
      if (rivalIsOut) return limit >= required ? bids(required) : passes();

      if (memory.bluff === null) {
        const unwanted = limit < minBid * (style.bluffBelow ?? 2);
        const bluff = unwanted && self.budget >= minBid * 4 && rng() < style.bluffChance;
        memory = { ...memory, bluff };
      }
      if (memory.bluff) return bids(Math.max(required, floor(bluffCeiling * 0.5)));
      if (limit < required) return passes();
      // Open low to buy cheaply: the rival cannot tell a low bid on a great
      // card from a low bid on a mediocre one.
      const opening = style.opensAtMinimum ? required : floor(limit * 0.25);
      return bids(Math.min(limit, Math.max(required, opening)));
    }

    const ceiling = memory.bluff ? bluffCeiling : limit;
    if (required > ceiling) return passes();
    const jump = style.noise > 0 && rng() < 0.25 && required + increment <= ceiling ? increment : 0;
    return bids(required + jump);
  }

  // ----- The rival drew the card: bid blind --------------------------------
  if (unseen.length === 0) return passes();
  const rivalWorth = valuer(rival.budget, rivalSlots, market);
  const bluffRate = style.rivalBluffRate ?? learnedBluffRate(memory, increment);

  // Weigh every card it could be by how well it explains the rival's bids.
  let total = 0;
  let winWeight = 0;
  let winValue = 0;
  for (const id of unseen) {
    const power = powerOf(id);
    const theirs = rivalWorth(power);
    const weight = likelihood(view, theirs, bluffRate);
    // I only win if the rival does not raise again.
    const stays =
      view.highBidder === null
        ? 1
        : 1 - (theirs >= required + increment ? RAISES_WHEN_WORTH_IT : RAISES_ANYWAY);
    total += weight;
    winWeight += weight * stays;
    winValue += weight * stays * myWorth(power);
  }
  if (winWeight <= 0 || total <= 0) return passes();

  const valueIfIWin = winValue / winWeight;
  const appetite = 1 + (rng() * 2 - 1) * style.noise;
  return valueIfIWin * appetite * (style.nerve ?? 1) >= required ? bids(required) : passes();
}

// ---------------------------------------------------------------------------
// Hard level: look ahead
// ---------------------------------------------------------------------------

/** Small seeded generator, so both options are tested on identical futures. */
function seededRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Rebuilds a full game from what the bot sees plus one guess at what it cannot see. */
function imagine(view: GameView, card: string, deck: string[]): GameState {
  return {
    settings: {
      budget: view.settings.budget,
      teamSize: view.settings.teamSize,
      minBid: view.settings.minBid,
      increment: view.settings.increment,
      passLimit: view.settings.passLimit,
    },
    scale: view.scale,
    players: [
      {
        name: view.players[0].name,
        budget: view.players[0].budget,
        team: view.players[0].team.slice(),
        passes: view.players[0].passes ?? 0,
      },
      {
        name: view.players[1].name,
        budget: view.players[1].budget,
        team: view.players[1].team.slice(),
        passes: view.players[1].passes ?? 0,
      },
    ],
    deck,
    phase: 'bidding',
    round: view.round,
    drawer: view.drawer,
    turn: view.turn,
    card,
    highBid: view.highBid,
    highBidder: view.highBidder,
    passed: [view.passed[0], view.passed[1]],
    history: view.history.slice(),
  };
}

function seatView(state: GameState, seat: Seat): GameView {
  const visible = state.phase === 'reveal' || (state.phase === 'bidding' && seat === state.drawer);
  return {
    code: null,
    status: 'playing',
    version: 0,
    you: seat,
    settings: { ...state.settings, poolSize: 0 },
    players: [
      { seat: 0, ...state.players[0] },
      { seat: 1, ...state.players[1] },
    ],
    phase: state.phase,
    round: state.round,
    drawer: state.drawer,
    turn: state.turn,
    highBid: state.highBid,
    highBidder: state.highBidder,
    passed: state.passed,
    scale: state.scale,
    deckCount: state.deck.length,
    card: visible ? state.card : null,
    history: state.history,
  };
}

/** Plays an imagined game to the end with two rule-based players. Returns the winner. */
function playOut(start: GameState, pool: readonly string[], rng: () => number, style: Style = NORMAL): Seat | null {
  let state = start;
  const memory: [BotMemory, BotMemory] = [emptyMemory(), emptyMemory()];
  for (let steps = 0; state.phase !== 'finished' && steps < 4000; steps++) {
    if (state.phase === 'reveal') {
      state = next(state);
      continue;
    }
    const seat = state.phase === 'draw' ? state.drawer : state.turn;
    // The bluff flag belongs to one round only.
    if (state.phase === 'draw') memory[seat] = { ...memory[seat], bluff: null };
    const { action, memory: updated } = byRules(
      seatView(state, seat),
      { pool, level: 'normal', memory: memory[seat] },
      style,
      rng,
    );
    memory[seat] = updated;
    state =
      action.type === 'draw'
        ? draw(state, seat)
        : action.type === 'pass'
          ? pass(state, seat)
          : bid(state, seat, action.amount);
  }
  const powers = (seat: Seat) => state.players[seat].team.map(powerOf);
  return judge(powers(0), powers(1)).winner;
}

export const DEFAULT_ROLLOUTS = 40;

function byLookingAhead(view: GameView, ctx: BotContext, rng: () => number): Decision {
  const instinct = byRules(view, ctx, ctx.instinctStyle ?? SHARP, rng);
  if (view.phase !== 'bidding') return instinct;

  const me = view.you as Seat;
  const rivalSeat = rivalOf(me);
  const { minBid, increment, teamSize } = view.settings;
  const self = view.players[me];
  const rival = view.players[rivalSeat];
  const required = view.highBidder === null ? minBid : view.highBid + increment;
  if (teamSize - self.team.length <= 0 || self.budget < required) return instinct;
  // No pass left to compare with: bidding is the only move.
  if (!canPass(view, me)) return instinct;

  const revealed = new Set(view.history.map((h) => h.card));
  const unseen = ctx.pool.filter((id) => !revealed.has(id));

  // Which card is it? Known if the bot drew it; otherwise every unseen card
  // is weighed by how well it explains what the rival has done.
  let candidates: string[];
  let cumulative: number[] = [];
  if (view.card !== null) {
    candidates = [view.card];
  } else {
    candidates = unseen;
    const market = marketOf(unseen, view.deckCount);
    const rivalWorth = valuer(rival.budget, teamSize - rival.team.length, market);
    const bluffRate = learnedBluffRate(ctx.memory, increment);
    let sum = 0;
    cumulative = unseen.map((id) => (sum += likelihood(view, rivalWorth(powerOf(id)), bluffRate)));
    if (sum <= 0) return instinct;
  }

  const options: BotAction[] = [{ type: 'pass' }, { type: 'bid', amount: required }];
  const score = [0, 0];
  const rollouts = ctx.rollouts ?? DEFAULT_ROLLOUTS;
  for (let i = 0; i < rollouts; i++) {
    let card = candidates[0];
    if (candidates.length > 1) {
      const pick = rng() * cumulative[cumulative.length - 1];
      card = candidates[cumulative.findIndex((c) => c >= pick)] ?? candidates[candidates.length - 1];
    }
    const deck = shuffle(
      unseen.filter((id) => id !== card),
      rng,
    ).slice(0, view.deckCount);
    const world = imagine(view, card, deck);
    const seed = Math.floor(rng() * 0xffffffff);

    options.forEach((option, index) => {
      const after = option.type === 'bid' ? bid(world, me, option.amount) : pass(world, me);
      // The same seed for both options: they are compared on the same future.
      const winner = playOut(after, ctx.pool, seededRng(seed), ctx.playoutStyle);
      score[index] += winner === me ? 1 : winner === null ? 0.5 : 0;
    });
  }

  // Only overrule instinct when looking ahead shows a real difference.
  const margin = (score[1] - score[0]) / rollouts;
  if (Math.abs(margin) < 0.04) return instinct;
  return { action: options[margin > 0 ? 1 : 0], memory: instinct.memory };
}

// ---------------------------------------------------------------------------

export function decide(view: GameView, ctx: BotContext): Decision {
  const rng = ctx.rng ?? Math.random;
  return ctx.level === 'hard' ? byLookingAhead(view, ctx, rng) : byRules(view, ctx, NORMAL, rng);
}

/** True when the bot in `view.you`'s seat is the one who has to act. */
export function isBotTurn(view: GameView): boolean {
  if (view.phase === 'draw') return view.drawer === view.you;
  return view.phase === 'bidding' && view.turn === view.you;
}
