/**
 * Character pools.
 *
 * The roster lives in rosters.json so that scripts can read it too
 * (`npm run ratings` rebuilds docs/POWER_RATINGS.md from it).
 * Only names, ratings and notes are stored. Cards are drawn by the app itself (see
 * components/CharacterCard.tsx); no artwork ships with the project.
 * To show a picture on a card, drop an image you are allowed to use into
 * src/assets/cards/ named after the character id (for example `goku.webp`).
 */

import rosters from './rosters.json';

export interface Universe {
  id: string;
  name: string;
  /** Spot colour used on the cards of this universe. */
  color: string;
}

export interface Character {
  id: string;
  name: string;
  universe: string;
  /**
   * Strength at the character's canon peak, 1 to 100, on one scale shared by
   * every universe. A judgment call, meant to be edited.
   */
  power: number;
  /** One line explaining the rating. */
  note: string;
}

export type Tier = 'S' | 'A' | 'B' | 'C' | 'D';

export const UNIVERSES: Universe[] = [
  { id: 'dragon-ball', name: 'Dragon Ball', color: '#ff8a1f' },
  { id: 'one-piece', name: 'One Piece', color: '#27a4f2' },
  { id: 'naruto', name: 'Naruto', color: '#f5b400' },
  { id: 'jujutsu-kaisen', name: 'Jujutsu Kaisen', color: '#8b6cff' },
  { id: 'bleach', name: 'Bleach', color: '#12b5a6' },
  { id: 'hunter-x-hunter', name: 'Hunter × Hunter', color: '#3fc46b' },
  { id: 'demon-slayer', name: 'Demon Slayer', color: '#ff5d93' },
];

/** `[name, power, note]`. See docs/POWER_RATINGS.md for the scale. */
type RosterEntry = [name: string, power: number, note: string];

const roster = rosters as unknown as Record<string, RosterEntry[]>;

/** "Monkey D. Luffy" → "monkey-d-luffy". Ids are stable: they are stored in rooms. */
export function slug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export const CHARACTERS: Character[] = UNIVERSES.flatMap((u) =>
  roster[u.id].map(([name, power, note]) => ({ id: slug(name), name, universe: u.id, power, note })),
);

const byId = new Map(CHARACTERS.map((c) => [c.id, c]));
const universeById = new Map(UNIVERSES.map((u) => [u.id, u]));

export const MIX_ID = 'mix';

/** Character ids for one universe, or for every universe with `MIX_ID`. */
export function poolFor(universeId: string): string[] {
  return CHARACTERS.filter((c) => universeId === MIX_ID || c.universe === universeId).map(
    (c) => c.id,
  );
}

/** Falls back to a readable card for ids this build does not know. */
export function getCharacter(id: string): Character {
  return byId.get(id) ?? { id, name: id, universe: 'unknown', power: 0, note: '' };
}

const topPower = new Map(
  UNIVERSES.map((u) => [u.id, Math.max(...roster[u.id].map(([, power]) => power))]),
);

/**
 * Where a character stands inside their own universe, relative to its
 * strongest character. Used to check that every roster has a spread of
 * strong, average and weak cards.
 */
export function tierOf(character: Character): Tier {
  const ratio = character.power / (topPower.get(character.universe) ?? 100);
  if (ratio >= 0.93) return 'S';
  if (ratio >= 0.82) return 'A';
  if (ratio >= 0.66) return 'B';
  if (ratio >= 0.45) return 'C';
  return 'D';
}

/**
 * How a card is framed: by its tier within its universe, and "apex" for the
 * strongest character of each universe. Purely visual.
 */
export type Rarity = 'common' | 'rare' | 'epic' | 'legendary' | 'mythic' | 'apex';

const RARITY: Record<Tier, Rarity> = { D: 'common', C: 'rare', B: 'epic', A: 'legendary', S: 'mythic' };

export function rarityOf(character: Character): Rarity {
  if (character.power > 0 && character.power === topPower.get(character.universe)) return 'apex';
  return RARITY[tierOf(character)];
}

export function getUniverse(id: string): Universe {
  return universeById.get(id) ?? { id, name: '', color: '#b9b9b0' };
}

/** Up to two letters shown large on the card. */
export function initials(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, ' ').split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  // "Android 17" and "Android 18" should not look the same.
  if (/^\d{1,2}$/.test(words[words.length - 1])) return words[words.length - 1];
  return (words[0][0] + words[words.length - 1][0]).toUpperCase();
}

// Optional pictures, picked up automatically at build time.
const imageModules = import.meta.glob('../assets/cards/*.{png,jpg,jpeg,webp,avif}', {
  eager: true,
  query: '?url',
  import: 'default',
}) as Record<string, string>;

const images = new Map(
  Object.entries(imageModules).map(([path, url]) => [
    path.split('/').pop()!.replace(/\.[^.]+$/, ''),
    url,
  ]),
);

export function getImage(id: string): string | undefined {
  return images.get(id);
}
