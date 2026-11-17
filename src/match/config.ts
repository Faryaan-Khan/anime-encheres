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
