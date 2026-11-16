import { describe, expect, it } from 'vitest';
import {
  CHARACTERS,
  MIX_ID,
  UNIVERSES,
  getCharacter,
  initials,
  poolFor,
  slug,
  tierOf,
} from './characters';

describe('character data', () => {
  it('has unique, URL-safe ids', () => {
    const ids = CHARACTERS.map((c) => c.id);
    const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(duplicates).toEqual([]);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('gives every universe enough characters for the largest team size', () => {
    for (const u of UNIVERSES) {
      // Teams go up to 7 and a deck holds 4 cards per slot.
      expect(poolFor(u.id).length).toBeGreaterThanOrEqual(28);
    }
    expect(poolFor(MIX_ID)).toHaveLength(CHARACTERS.length);
  });

  it('fits in one online room (the server accepts up to 400 ids of 64 characters)', () => {
    expect(CHARACTERS.length).toBeLessThanOrEqual(400);
    for (const c of CHARACTERS) expect(c.id.length).toBeLessThanOrEqual(64);
  });

  it('rates every character from 1 to 100 with a reason', () => {
    for (const c of CHARACTERS) {
      expect(Number.isInteger(c.power), c.name).toBe(true);
      expect(c.power, c.name).toBeGreaterThanOrEqual(1);
      expect(c.power, c.name).toBeLessThanOrEqual(100);
      expect(c.note.length, c.name).toBeGreaterThan(3);
    }
  });

  it('lists each roster from strongest to weakest', () => {
    for (const u of UNIVERSES) {
      const powers = CHARACTERS.filter((c) => c.universe === u.id).map((c) => c.power);
      expect(powers, u.name).toEqual(powers.slice().sort((a, b) => b - a));
    }
  });

  it('gives every universe strong, average and weak cards', () => {
    for (const u of UNIVERSES) {
      const tiers = CHARACTERS.filter((c) => c.universe === u.id).map(tierOf);
      const count = (tier: string) => tiers.filter((t) => t === tier).length;
      expect(count('S'), `${u.name} S`).toBeGreaterThanOrEqual(2);
      expect(count('A') + count('B'), `${u.name} A/B`).toBeGreaterThanOrEqual(8);
      expect(count('C') + count('D'), `${u.name} C/D`).toBeGreaterThanOrEqual(5);
      // Top tiers must stay rare, or there is nothing to bluff about.
      expect(count('S') / tiers.length, `${u.name} S share`).toBeLessThanOrEqual(0.3);
    }
  });

  it('builds slugs and initials', () => {
    expect(slug('Monkey D. Luffy')).toBe('monkey-d-luffy');
    expect(slug('Hunter × Hunter')).toBe('hunter-hunter');
    expect(initials('Goku')).toBe('GO');
    expect(initials('Monkey D. Luffy')).toBe('ML');
    expect(initials('Android 18')).toBe('18');
  });

  it('falls back gracefully for unknown ids', () => {
    expect(getCharacter('someone-new').name).toBe('someone-new');
  });
});
