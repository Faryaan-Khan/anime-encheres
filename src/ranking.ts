/** Leagues and badges, derived from a profile. Nothing here is stored. */
import { MIX_ID, UNIVERSES } from './data/characters';
import type { StringKey } from './i18n/strings';
import type { Profile } from './online/profile';

export interface League {
  key: StringKey;
  /** Trophies needed to enter. */
  from: number;
  color: string;
}

export const LEAGUES: League[] = [
  { key: 'league.bronze', from: 0, color: '#c98a4b' },
  { key: 'league.silver', from: 300, color: '#aeb6bf' },
  { key: 'league.gold', from: 600, color: '#ffd60a' },
  { key: 'league.platinum', from: 1000, color: '#5fd3c4' },
  { key: 'league.diamond', from: 1500, color: '#7aa8ff' },
  { key: 'league.legend', from: 2200, color: '#ff5d93' },
];

export function leagueOf(trophies: number): League {
  return [...LEAGUES].reverse().find((league) => trophies >= league.from) ?? LEAGUES[0];
}

/** The next league up and how many trophies are missing; `null` at the top. */
export function nextLeague(trophies: number): { league: League; missing: number } | null {
  const next = LEAGUES.find((league) => league.from > trophies);
  return next ? { league: next, missing: next.from - trophies } : null;
}

/**
 * The overall score: a weighted average of the trophies in every mode (each
 * universe, mixed, and 1v1v1). Mixed counts double because it asks for
 * knowledge of every series, and a mode never played counts as zero. Mirrors `encheres.overall` in the database,
 * which is the one that counts; this copy explains the number to the player.
 */
export const MIX_SHARES = 2;
/** 1v1v1 has one rating for every universe, which counts as one more mode. */
export const TRIO_ID = 'trio';
export const OVERALL_SHARES = UNIVERSES.length + MIX_SHARES + 1;

export function overallScore(trophies: Record<string, number>): number {
  const total = Object.entries(trophies).reduce(
    (sum, [mode, value]) => sum + value * (mode === MIX_ID ? MIX_SHARES : 1),
    0,
  );
  return Math.round(total / OVERALL_SHARES);
}

type Stats = Pick<Profile, 'games' | 'wins' | 'peak' | 'bestStreak'>;

/**
 * One badge per kind of achievement. It is earned once and then levels up,
 * instead of a new badge appearing at every milestone.
 */
const FAMILIES: Array<{ key: StringKey; steps: number[]; value(p: Stats): number }> = [
  { key: 'badge.games', steps: [1, 10, 50, 100, 500], value: (p) => p.games },
  { key: 'badge.wins', steps: [1, 10, 50, 200, 1000], value: (p) => p.wins },
  { key: 'badge.streak', steps: [3, 5, 7, 10, 15], value: (p) => p.bestStreak },
  { key: 'badge.league', steps: LEAGUES.slice(1).map((league) => league.from), value: (p) => p.peak },
];

export interface Badge {
  key: StringKey;
  /** 0 when not earned yet. */
  level: number;
  levels: number;
  /** The milestone that gave the current level. */
  reached: number | null;
  /** The milestone of the next level; `null` at the top. */
  next: number | null;
}

export function badgesOf(profile: Stats): Badge[] {
  return FAMILIES.map(({ key, steps, value }) => {
    const level = steps.filter((step) => value(profile) >= step).length;
    return {
      key,
      level,
      levels: steps.length,
      reached: level > 0 ? steps[level - 1] : null,
      next: steps[level] ?? null,
    };
  });
}

/**
 * Where a mode's trophies land when a new month starts: below 500 they stay;
 * otherwise they drop to the floor of their bracket. Same as
 * encheres.season_floor in SQL.
 */
export function seasonFloor(trophies: number): number {
  if (trophies < 500) return trophies;
  if (trophies < 1000) return 500;
  if (trophies < 1500) return 999;
  if (trophies < 2000) return 1499;
  return 1999;
}
