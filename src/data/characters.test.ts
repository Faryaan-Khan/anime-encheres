import { describe, expect, it } from 'vitest';
import { CHARACTERS, MIX_ID, UNIVERSES, getCharacter, initials, poolFor, slug } from './characters';

describe('character data', () => {
  it('has unique, URL-safe ids', () => {
    const ids = CHARACTERS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it('gives every universe enough characters for the largest team size', () => {
    for (const u of UNIVERSES) {
      // Teams go up to 7, so a universe needs at least 14 characters.
      expect(poolFor(u.id).length).toBeGreaterThanOrEqual(14);
    }
    expect(poolFor(MIX_ID)).toHaveLength(CHARACTERS.length);
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
