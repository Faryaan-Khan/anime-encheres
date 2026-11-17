import { describe, expect, it } from 'vitest';
import { LEAGUES, badgesOf, leagueOf, nextLeague } from './ranking';

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
  it('are earned from stats', () => {
    const none = badgesOf({ games: 0, wins: 0, best: 0, bestStreak: 0 });
    expect(none.every((b) => !b.earned)).toBe(true);
    const some = badgesOf({ games: 12, wins: 10, best: 320, bestStreak: 3 });
    expect(some.filter((b) => b.earned).map((b) => b.key)).toEqual([
      'badge.firstGame', 'badge.firstWin', 'badge.wins10', 'badge.streak3', 'badge.silver',
    ]);
  });
});
