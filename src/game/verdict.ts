/**
 * Who has the better team?
 *
 * Strength is exponential in power: every POWER_STEP points doubles it. A
 * team's strength is the sum of its members' strengths, which makes the
 * result top-heavy on purpose. One character far above the rest outweighs
 * several weaker ones, the way Beerus (95) handles Goku (92) and Vegeta (91)
 * together: 2^(95/2.5) is larger than 2^(92/2.5) + 2^(91/2.5).
 *
 * `teamPower` converts the sum back to the 1–100 scale: it is the power of
 * the single character who would be exactly as strong as the whole team.
 */
import type { Seat } from './types';

/** Power points that double a character's strength. */
export const POWER_STEP = 2.5;

export function strength(power: number): number {
  return power > 0 ? 2 ** (power / POWER_STEP) : 0;
}

export function teamStrength(powers: readonly number[]): number {
  return powers.reduce((sum, power) => sum + strength(power), 0);
}

/** Power of one character equal to the whole team; 0 for an empty team. */
export function teamPower(powers: readonly number[]): number {
  const total = teamStrength(powers);
  return total > 0 ? POWER_STEP * Math.log2(total) : 0;
}

export type Margin = 'tie' | 'narrow' | 'clear' | 'crushing';

export interface Verdict {
  /** Team power of each seat, on the 1–100 scale. */
  power: [number, number];
  winner: Seat | null;
  margin: Margin;
  /** How many times stronger the winning team is (1 for a tie). */
  ratio: number;
}

/** Below this gap in team power the fight could go either way. */
const TIE_GAP = 0.4;
/** Up to one doubling: a real fight. */
const NARROW_GAP = POWER_STEP;
/** Up to three doublings: not close, but not a massacre. */
const CLEAR_GAP = POWER_STEP * 3;

export function judge(teamA: readonly number[], teamB: readonly number[]): Verdict {
  const power: [number, number] = [teamPower(teamA), teamPower(teamB)];
  const gap = Math.abs(power[0] - power[1]);
  if (gap < TIE_GAP) return { power, winner: null, margin: 'tie', ratio: 1 };
  const margin: Margin = gap < NARROW_GAP ? 'narrow' : gap < CLEAR_GAP ? 'clear' : 'crushing';
  return { power, winner: power[0] > power[1] ? 0 : 1, margin, ratio: 2 ** (gap / POWER_STEP) };
}
