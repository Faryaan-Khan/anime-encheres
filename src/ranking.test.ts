import { describe, expect, it } from 'vitest';
import { LEAGUES, OVERALL_SHARES, badgesOf, leagueOf, nextLeague, overallScore } from './ranking';

describe('leagues', () => {
  it('are entered at their threshold', () => {
    expect(leagueOf(0).key).toBe('league.bronze');
    expect(leagueOf(299).key).toBe('league.bronze');
    expect(leagueOf(300).key).toBe('league.silver');
    expect(leagueOf(5000).key).toBe('league.legend');
    expect(LEAGUES.map((l) => l.from)).toEqual([...LEAGUES.map((l) => l.from)].sort((a, b) => a - b));
  });

  it('report the distance to the next one', () => {
    expect(nextLeague(250)).toMatchObject({ missing: 50, league: { key: 'league.silver' } });
    expect(nextLeague(2200)).toBeNull();
  });
});

describe('badges', () => {
  it('start unearned, with the first milestone in sight', () => {
    const none = badgesOf({ games: 0, wins: 0, peak: 0, bestStreak: 0 });
    expect(none.map((b) => b.key)).toEqual(['badge.games', 'badge.wins', 'badge.streak', 'badge.league']);
    expect(none.every((b) => b.level === 0 && b.reached === null)).toBe(true);
    expect(none.map((b) => b.next)).toEqual([1, 1, 3, 300]);
  });

  it('level up in place instead of multiplying', () => {
    const some = badgesOf({ games: 120, wins: 49, peak: 640, bestStreak: 4 });
    expect(some).toHaveLength(4);
    expect(some.map((b) => [b.level, b.reached, b.next])).toEqual([
      [4, 100, 500],
      [2, 10, 50],
      [1, 3, 5],
      [2, 600, 1000],
    ]);
  });

  it('stop at the top level', () => {
    const top = badgesOf({ games: 9999, wins: 9999, peak: 9999, bestStreak: 99 });
    expect(top.every((b) => b.level === b.levels && b.next === null)).toBe(true);
  });
});

describe('the overall score', () => {
  it('averages every mode, counting mixed double and unplayed modes as zero', () => {
    expect(OVERALL_SHARES).toBe(10);
    expect(overallScore({})).toBe(0);
    expect(overallScore({ naruto: 900 })).toBe(90);
    expect(overallScore({ mix: 900 })).toBe(180);
    expect(overallScore({ naruto: 900, mix: 450 })).toBe(180);
    expect(overallScore({ trio: 900 })).toBe(90);
  });
});
