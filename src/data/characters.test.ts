import { describe, expect, it } from 'vitest';
import {
  ALL_SCALE,
  CHARACTERS,
  MIX_ID,
  UNIVERSES,
  getCharacter,
  initials,
  overallRank,
  poolFor,
  powerIn,
  scaleFactor,
  scaleOf,
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

describe('universe scales', () => {
  it('put each universe’s strongest at 100 and keep everyone’s share of that', () => {
    for (const universe of UNIVERSES) {
      const own = CHARACTERS.filter((c) => c.universe === universe.id);
      const top = Math.max(...own.map((c) => c.power));
      expect(Math.max(...own.map((c) => powerIn(c, universe.id)))).toBe(100);
      for (const c of own) {
        expect(powerIn(c, universe.id)).toBe(Math.round((100 * c.power) / top));
        expect(powerIn(c, ALL_SCALE)).toBe(c.power);
      }
    }
  });

  it('pick a universe’s scale only when every card comes from it', () => {
    expect(scaleOf(poolFor('bleach'))).toBe('bleach');
    expect(scaleOf(poolFor(MIX_ID))).toBe(ALL_SCALE);
    expect(scaleOf([])).toBe(ALL_SCALE);
    expect(scaleFactor('one-piece')).toBeCloseTo(100 / 58);
    expect(scaleFactor(ALL_SCALE)).toBe(1);
  });
});

describe('overall ranking', () => {
  it('ranks everyone once, strongest first', () => {
    const ranks = CHARACTERS.map((c) => overallRank(c.id));
    expect(new Set(ranks).size).toBe(CHARACTERS.length);
    expect(Math.min(...ranks)).toBe(1);
    expect(Math.max(...ranks)).toBe(CHARACTERS.length);
    expect(overallRank(slug('Zeno'))).toBe(1);
    for (const a of CHARACTERS) {
      for (const b of CHARACTERS) {
        if (a.power > b.power) expect(overallRank(a.id)).toBeLessThan(overallRank(b.id));
      }
    }
  });
});

describe('card pictures', () => {
  it('each belong to a character, and each is listed in the credits', async () => {
    const { readdirSync, readFileSync } = await import('node:fs');
    const folder = new URL('../assets/cards/', import.meta.url);
    const pictures = readdirSync(folder).filter((f) => /\.(png|jpe?g|webp|avif)$/.test(f));
    const credits = readFileSync(new URL('CREDITS.md', folder), 'utf8');
    const ids = new Set(CHARACTERS.map((c) => c.id));
    for (const file of pictures) {
      expect(ids.has(file.replace(/\.[^.]+$/, '')), `${file} matches a character id`).toBe(true);
      expect(credits.includes(`| ${file} |`), `${file} is in CREDITS.md`).toBe(true);
    }
    expect(pictures.length).toBeGreaterThanOrEqual(53);
    // Every picture has its face placed by hand for profile pictures (src/data/faces.json).
    const faces = JSON.parse(readFileSync(new URL('../data/faces.json', import.meta.url), 'utf8'));
    for (const file of pictures) {
      const face = faces[file.replace(/\.[^.]+$/, '')];
      expect(face && !face.guess, `${file} has a face position`).toBe(true);
    }
    for (const id of Object.keys(faces)) expect(ids.has(id), `faces.json: ${id} is a character`).toBe(true);
  });
});
