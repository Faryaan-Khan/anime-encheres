import { useCallback, useState } from 'react';
import { decide, emptyMemory, isBotTurn, observe, type BotLevel, type BotMemory } from '../bot/bot';
import { bid, canStillBuy, createGame, draw, next, pass, toView } from '../game/engine';
import type { GameState, Settings } from '../game/types';
import { readStored, removeStored, writeStored } from '../storage';

const DEFAULT_KEY = 'ae.local';

/** The computer always sits in the second seat. */
export const BOT_SEAT = 1;
const PLAYER_SEAT = 0;

export interface LocalSetup {
  settings: Settings;
  names: [string, string];
  pool: string[];
  /** Set when the second player is the computer. */
  bot?: BotLevel;
}

interface Saved {
  setup: LocalSetup;
  state: GameState;
  /** What the computer remembers about this game. */
  memory?: BotMemory;
}

function load(key: string): Saved | null {
  try {
    const raw = readStored(key);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    return saved?.state?.players?.length === 2 && saved.setup ? saved : null;
  } catch {
    return null;
  }
}

/** True when a game on this device was left unfinished. */
export function hasSavedLocalGame(): boolean {
  const saved = load(DEFAULT_KEY);
  return saved !== null && saved.state.phase !== 'finished';
}

/** Lets the computer watch every new state, exactly as a player in its seat would. */
function watched(setup: LocalSetup, state: GameState, memory?: BotMemory): Saved {
  if (!setup.bot) return { setup, state };
  return {
    setup,
    state,
    memory: observe(memory ?? emptyMemory(), toView(state, BOT_SEAT), setup.pool),
  };
}

/**
 * A game played on this device: two people sharing the screen, or one person
 * against the computer. The whole state lives in the browser and is saved
 * after every move, so closing the tab does not lose the game.
 */
export function useLocalGame(key: string = DEFAULT_KEY) {
  const [saved, setSaved] = useState<Saved | null>(() => load(key));

  const commit = useCallback(
    (value: Saved | null) => {
      setSaved(value);
      if (value) writeStored(key, JSON.stringify(value));
      else removeStored(key);
    },
    [key],
  );

  const start = useCallback(
    (setup: LocalSetup) => commit(watched(setup, createGame(setup))),
    [commit],
  );

  const apply = useCallback(
    (move: (state: GameState) => GameState) => {
      if (saved) commit(watched(saved.setup, move(saved.state), saved.memory));
    },
    [commit, saved],
  );

  /** Plays the computer's move, if it is the computer's turn. */
  const playBot = useCallback(() => {
    if (!saved?.setup.bot) return;
    const view = toView(saved.state, BOT_SEAT);
    if (!isBotTurn(view)) return;
    const { action, memory } = decide(view, {
      pool: saved.setup.pool,
      level: saved.setup.bot,
      memory: saved.memory ?? emptyMemory(),
    });
    const state =
      action.type === 'draw'
        ? draw(saved.state, BOT_SEAT)
        : action.type === 'pass'
          ? pass(saved.state, BOT_SEAT)
          : bid(saved.state, BOT_SEAT, action.amount);
    commit(watched(saved.setup, state, memory));
  }, [commit, saved]);

  /**
   * Once the player cannot buy any more, nothing the computer does can change
   * their team: it finishes its own at once and the game ends.
   */
  const finishForBot = useCallback(() => {
    if (!saved?.setup.bot || canStillBuy(saved.state, PLAYER_SEAT)) return;
    let state = saved.state;
    let memory = saved.memory ?? emptyMemory();
    for (let step = 0; step < 400 && state.phase !== 'finished'; step++) {
      if (state.phase === 'reveal') {
        state = next(state);
        continue;
      }
      const view = toView(state, BOT_SEAT);
      if (isBotTurn(view)) {
        const decided = decide(view, { pool: saved.setup.pool, level: saved.setup.bot, memory });
        memory = decided.memory;
        const action = decided.action;
        state =
          action.type === 'draw'
            ? draw(state, BOT_SEAT)
            : action.type === 'pass'
              ? pass(state, BOT_SEAT)
              : bid(state, BOT_SEAT, action.amount);
      } else if (state.phase === 'draw') {
        state = draw(state, state.drawer);
      } else {
        state = pass(state, state.turn);
      }
      memory = observe(memory, toView(state, BOT_SEAT), saved.setup.pool);
    }
    commit({ setup: saved.setup, state, memory });
  }, [commit, saved]);

  return {
    state: saved?.state ?? null,
    poolSize: saved?.setup.pool.length ?? 0,
    bot: saved?.setup.bot ?? null,
    names: saved?.setup.names ?? null,
    start,
    rematch: () => saved && commit(watched(saved.setup, createGame(saved.setup))),
    clear: () => commit(null),
    draw: () => apply((s) => draw(s, s.drawer)),
    bid: (amount: number) => apply((s) => bid(s, s.turn, amount)),
    pass: () => apply((s) => pass(s, s.turn)),
    next: () => apply(next),
    playBot,
    finishForBot,
  };
}
