/**
 * Quick-match settings.
 *
 * When nobody else is looking for a game, the player is paired with the
 * computer under an ordinary-looking name. That is a product decision:
 * players are not told. Set DISCLOSE_STAND_IN_AFTER_MATCH to true to add a
 * line on the final screen saying the opponent was the computer.
 */
import type { BotLevel } from '../bot/bot';
import { UNIVERSES, poolFor } from '../data/characters';
import { DEFAULT_SETTINGS } from '../game/engine';
import type { Settings } from '../game/types';

/** Every quick match uses the same rules so that any two players can be paired. */
export const MATCH_SETTINGS: Settings = { ...DEFAULT_SETTINGS };

/** How long to look for a human opponent before the computer steps in, in seconds. */
export const STAND_IN_AFTER_SECONDS: readonly [min: number, max: number] = [12, 18];

export const DISCLOSE_STAND_IN_AFTER_MATCH = false;

const between = (min: number, max: number, rng: () => number) => min + rng() * (max - min);

export function standInDelayMs(rng: () => number = Math.random): number {
  return between(STAND_IN_AFTER_SECONDS[0], STAND_IN_AFTER_SECONDS[1], rng) * 1000;
}

/** One universe at random; mixing everything would let one series dominate. */
export function randomMatchPool(rng: () => number = Math.random): string[] {
  return poolFor(UNIVERSES[Math.floor(rng() * UNIVERSES.length)].id);
}

export function randomStandInLevel(rng: () => number = Math.random): BotLevel {
  return rng() < 0.5 ? 'normal' : 'hard';
}

const FIRST_NAMES = [
  'Rayan', 'Lina', 'Kenji', 'Sami', 'Noa', 'Akira', 'Mehdi', 'Yuna', 'Tom', 'Ines', 'Leo', 'Sora',
  'Hugo', 'Nina', 'Ilyes', 'Maya', 'Enzo', 'Sarah', 'Adam', 'Jade', 'Nassim', 'Lea', 'Yanis', 'Emma',
];

/** A plain player name, sometimes with the digits or prefix people add to theirs. */
export function standInName(avoid: string, rng: () => number = Math.random): string {
  for (let attempt = 0; attempt < 20; attempt++) {
    const base = FIRST_NAMES[Math.floor(rng() * FIRST_NAMES.length)];
    const style = rng();
    const name =
      style < 0.45
        ? base
        : style < 0.8
          ? `${base}${Math.floor(between(10, 100, rng))}`
          : style < 0.9
            ? `${base.toLowerCase()}_${Math.floor(between(1, 10, rng))}`
            : `x${base}`;
    if (name.toLowerCase() !== avoid.trim().toLowerCase()) return name;
  }
  return 'Player2';
}

/** Pause before the stand-in acts, so that it moves at a human pace. */
export function standInPauseMs(isBid: boolean, rng: () => number = Math.random): number {
  return isBid ? between(1300, 4200, rng) : between(800, 2200, rng);
}
