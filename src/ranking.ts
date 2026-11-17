/** Leagues and badges, derived from a profile. Nothing here is stored. */
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

export interface Badge {
  key: StringKey;
  earned: boolean;
}

type Stats = Pick<Profile, 'games' | 'wins' | 'best' | 'bestStreak'>;

const BADGES: Array<{ key: StringKey; test(p: Stats): boolean }> = [
  { key: 'badge.firstGame', test: (p) => p.games >= 1 },
  { key: 'badge.firstWin', test: (p) => p.wins >= 1 },
  { key: 'badge.wins10', test: (p) => p.wins >= 10 },
  { key: 'badge.wins50', test: (p) => p.wins >= 50 },
  { key: 'badge.games100', test: (p) => p.games >= 100 },
  { key: 'badge.streak3', test: (p) => p.bestStreak >= 3 },
  { key: 'badge.streak7', test: (p) => p.bestStreak >= 7 },
  { key: 'badge.silver', test: (p) => p.best >= 300 },
  { key: 'badge.gold', test: (p) => p.best >= 600 },
  { key: 'badge.legend', test: (p) => p.best >= 2200 },
];

export function badgesOf(profile: Stats): Badge[] {
  return BADGES.map(({ key, test }) => ({ key, earned: test(profile) }));
}
