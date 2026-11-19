/**
 * Quick-match settings. Who sits in the other seat, which cards are dealt and
 * after how long the computer joins are all decided by the server.
 */
import { MIX_ID, UNIVERSES } from '../data/characters';
import { DEFAULT_SETTINGS } from '../game/engine';
import type { Settings } from '../game/types';

/** Every quick match uses the same rules so that any two players can be paired. */
export const MATCH_SETTINGS: Settings = { ...DEFAULT_SETTINGS };

/** Ranked modes: all universes mixed, then each universe on its own. */
export const MODES: string[] = [MIX_ID, ...UNIVERSES.map((u) => u.id)];

export function isMode(id: string | null | undefined): id is string {
  return typeof id === 'string' && MODES.includes(id);
}

/**
 * The 1v1v1 rating: one for every universe. A 1v1v1 queue is written
 * `trio:<universe or mix>`; a 1v1 queue is the mode itself.
 */
export const TRIO = 'trio';
const TRIO_PREFIX = 'trio:';

/** Ratings, as shown on profiles and leaderboards: every 1v1 mode, then 1v1v1. */
export const RATINGS: string[] = [...MODES, TRIO];

export function trioQueue(verse: string): string {
  return `${TRIO_PREFIX}${verse}`;
}

/** The universe (or mix) of a 1v1v1 queue, or null for a 1v1 queue. */
export function trioVerse(queue: string): string | null {
  return queue.startsWith(TRIO_PREFIX) ? queue.slice(TRIO_PREFIX.length) : null;
}

/** A queue the quick match screen can search in. */
export function isQueue(id: string | null | undefined): id is string {
  if (typeof id !== 'string') return false;
  const verse = trioVerse(id);
  return verse === null ? isMode(id) : isMode(verse);
}

/** The rating a queue's trophies go to. */
export function ratingOf(queue: string): string {
  return trioVerse(queue) === null ? queue : TRIO;
}
