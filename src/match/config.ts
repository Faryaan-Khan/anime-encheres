/**
 * Quick-match settings. Who sits in the other seat, and after how long, is
 * decided by the server (supabase/migrations/0005_accounts_and_opponent.sql).
 */
import { UNIVERSES, poolFor } from '../data/characters';
import { DEFAULT_SETTINGS } from '../game/engine';
import type { Settings } from '../game/types';

/** Every quick match uses the same rules so that any two players can be paired. */
export const MATCH_SETTINGS: Settings = { ...DEFAULT_SETTINGS };

/** One universe at random; mixing everything would let one series dominate. */
export function randomMatchPool(rng: () => number = Math.random): string[] {
  return poolFor(UNIVERSES[Math.floor(rng() * UNIVERSES.length)].id);
}
