import { describe, expect, it } from 'vitest';
import { getCharacter } from '../data/characters';
import { judge, strength, teamPower } from './verdict';

const power = (...ids: string[]) => ids.map((id) => getCharacter(id).power);

describe('team power', () => {
  it('doubles strength every 2.5 points', () => {
    expect(strength(52.5) / strength(50)).toBeCloseTo(2);
    expect(strength(0)).toBe(0);
  });

  it('of one character is that character', () => {
    expect(teamPower([64])).toBeCloseTo(64);
    expect(teamPower([])).toBe(0);
  });

  it('adds little when a weak character joins a strong one', () => {
    expect(teamPower([90, 30])).toBeCloseTo(90, 3);
    expect(teamPower([50, 50])).toBeCloseTo(52.5);
  });
});

describe('verdict', () => {
  it('lets Beerus take Goku and Vegeta at once', () => {
    const v = judge(power('beerus'), power('goku', 'vegeta'));
    expect(v.winner).toBe(0);
    expect(v.margin).toBe('narrow');
  });

  it('but numbers win when the gap is small', () => {
    expect(judge(power('goku'), power('vegeta', 'gohan')).winner).toBe(1);
    expect(judge(power('monkey-d-luffy'), power('roronoa-zoro', 'sanji')).winner).toBe(0);
  });

  it('grades the margin', () => {
    expect(judge([50], [50]).margin).toBe('tie');
    expect(judge([50], [50]).winner).toBeNull();
    expect(judge([52], [50]).margin).toBe('narrow');
    expect(judge([56], [50]).margin).toBe('clear');
    expect(judge([60], [50]).margin).toBe('crushing');
    expect(judge([55], [50]).ratio).toBeCloseTo(4);
  });

  it('is symmetric and handles empty teams', () => {
    expect(judge([40, 30], [60]).winner).toBe(1);
    expect(judge([60], [40, 30]).winner).toBe(0);
    expect(judge([], []).margin).toBe('tie');
    expect(judge([5], []).winner).toBe(0);
  });
});
