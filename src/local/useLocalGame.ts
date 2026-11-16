import { useCallback, useState } from 'react';
import { bid, createGame, draw, next, pass } from '../game/engine';
import type { GameState, Settings } from '../game/types';
import { readStored, removeStored, writeStored } from '../storage';

const KEY = 'ae.local';

export interface LocalSetup {
  settings: Settings;
  names: [string, string];
  pool: string[];
}

interface Saved {
  setup: LocalSetup;
  state: GameState;
}

function load(): Saved | null {
  try {
    const raw = readStored(KEY);
    if (!raw) return null;
    const saved = JSON.parse(raw) as Saved;
    return saved?.state?.players?.length === 2 && saved.setup ? saved : null;
  } catch {
    return null;
  }
}

/** True when a same-device game was left unfinished on this device. */
export function hasSavedLocalGame(): boolean {
  const saved = load();
  return saved !== null && saved.state.phase !== 'finished';
}

/**
 * Same-device game: the whole state lives in the browser and is saved after
 * every move, so closing the tab does not lose the game.
 */
export function useLocalGame() {
  const [saved, setSaved] = useState<Saved | null>(load);

  const commit = useCallback((value: Saved | null) => {
    setSaved(value);
    if (value) writeStored(KEY, JSON.stringify(value));
    else removeStored(KEY);
  }, []);

  const start = useCallback(
    (setup: LocalSetup) => commit({ setup, state: createGame(setup) }),
    [commit],
  );

  const apply = useCallback(
    (move: (state: GameState) => GameState) => {
      if (saved) commit({ setup: saved.setup, state: move(saved.state) });
    },
    [commit, saved],
  );

  return {
    state: saved?.state ?? null,
    poolSize: saved?.setup.pool.length ?? 0,
    start,
    rematch: () => saved && commit({ setup: saved.setup, state: createGame(saved.setup) }),
    clear: () => commit(null),
    draw: () => apply((s) => draw(s, s.drawer)),
    bid: (amount: number) => apply((s) => bid(s, s.turn, amount)),
    pass: () => apply((s) => pass(s, s.turn)),
    next: () => apply(next),
  };
}
