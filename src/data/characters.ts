/**
 * Character pools.
 *
 * Only names are stored here. Cards are drawn by the app itself (see
 * components/CharacterCard.tsx); no artwork ships with the project.
 * To show a picture on a card, drop an image you are allowed to use into
 * src/assets/cards/ named after the character id (for example `goku.webp`).
 */

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
}

export const UNIVERSES: Universe[] = [
  { id: 'dragon-ball', name: 'Dragon Ball', color: '#ff8a1f' },
  { id: 'one-piece', name: 'One Piece', color: '#27a4f2' },
  { id: 'naruto', name: 'Naruto', color: '#f5b400' },
  { id: 'jujutsu-kaisen', name: 'Jujutsu Kaisen', color: '#8b6cff' },
  { id: 'bleach', name: 'Bleach', color: '#12b5a6' },
  { id: 'hunter-x-hunter', name: 'Hunter × Hunter', color: '#3fc46b' },
  { id: 'demon-slayer', name: 'Demon Slayer', color: '#ff5d93' },
];

const roster: Record<string, string[]> = {
  'dragon-ball': [
    'Goku', 'Vegeta', 'Gohan', 'Piccolo', 'Trunks', 'Goten', 'Krillin', 'Frieza',
    'Cell', 'Majin Buu', 'Beerus', 'Whis', 'Jiren', 'Broly', 'Hit', 'Android 17',
    'Android 18', 'Zamasu', 'Goku Black', 'Master Roshi', 'Tien', 'Yamcha', 'Kefla', 'Toppo',
  ],
  'one-piece': [
    'Monkey D. Luffy', 'Roronoa Zoro', 'Sanji', 'Nami', 'Usopp', 'Tony Tony Chopper',
    'Nico Robin', 'Franky', 'Brook', 'Jinbe', 'Portgas D. Ace', 'Sabo', 'Trafalgar Law',
    'Eustass Kid', 'Shanks', 'Dracule Mihawk', 'Whitebeard', 'Kaido', 'Big Mom',
    'Blackbeard', 'Donquixote Doflamingo', 'Crocodile', 'Boa Hancock', 'Akainu',
    'Aokiji', 'Kizaru', 'Monkey D. Garp', 'Gol D. Roger',
  ],
  naruto: [
    'Naruto Uzumaki', 'Sasuke Uchiha', 'Sakura Haruno', 'Kakashi Hatake', 'Itachi Uchiha',
    'Madara Uchiha', 'Obito Uchiha', 'Minato Namikaze', 'Jiraiya', 'Tsunade', 'Orochimaru',
    'Pain', 'Gaara', 'Rock Lee', 'Might Guy', 'Neji Hyuga', 'Shikamaru Nara', 'Hinata Hyuga',
    'Hashirama Senju', 'Tobirama Senju', 'Kisame Hoshigaki', 'Deidara', 'Killer Bee',
    'Kaguya Otsutsuki',
  ],
  'jujutsu-kaisen': [
    'Yuji Itadori', 'Megumi Fushiguro', 'Nobara Kugisaki', 'Satoru Gojo', 'Ryomen Sukuna',
    'Suguru Geto', 'Kento Nanami', 'Maki Zenin', 'Toge Inumaki', 'Panda', 'Yuta Okkotsu',
    'Toji Fushiguro', 'Mahito', 'Jogo', 'Hanami', 'Choso', 'Aoi Todo', 'Kinji Hakari',
    'Kenjaku', 'Yuki Tsukumo', 'Naoya Zenin', 'Hiromi Higuruma',
  ],
  bleach: [
    'Ichigo Kurosaki', 'Rukia Kuchiki', 'Renji Abarai', 'Byakuya Kuchiki', 'Kenpachi Zaraki',
    'Toshiro Hitsugaya', 'Sosuke Aizen', 'Gin Ichimaru', 'Kisuke Urahara', 'Yoruichi Shihoin',
    'Genryusai Yamamoto', 'Ulquiorra Cifer', 'Grimmjow Jaegerjaquez', 'Coyote Starrk',
    'Uryu Ishida', 'Yasutora Sado', 'Orihime Inoue', 'Shunsui Kyoraku', 'Yhwach',
    'Retsu Unohana', 'Mayuri Kurotsuchi', 'Kaname Tosen',
  ],
  'hunter-x-hunter': [
    'Gon Freecss', 'Killua Zoldyck', 'Kurapika', 'Leorio Paradinight', 'Hisoka Morow',
    'Chrollo Lucilfer', 'Meruem', 'Isaac Netero', 'Illumi Zoldyck', 'Ging Freecss',
    'Biscuit Krueger', 'Neferpitou', 'Feitan Portor', 'Uvogin', 'Kite', 'Knuckle Bine',
    'Morel Mackernasey', 'Zeno Zoldyck', 'Silva Zoldyck', 'Alluka Zoldyck',
  ],
  'demon-slayer': [
    'Tanjiro Kamado', 'Nezuko Kamado', 'Zenitsu Agatsuma', 'Inosuke Hashibira', 'Giyu Tomioka',
    'Kyojuro Rengoku', 'Shinobu Kocho', 'Tengen Uzui', 'Muichiro Tokito', 'Mitsuri Kanroji',
    'Obanai Iguro', 'Sanemi Shinazugawa', 'Gyomei Himejima', 'Muzan Kibutsuji', 'Kokushibo',
    'Doma', 'Akaza', 'Yoriichi Tsugikuni',
  ],
};

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
  roster[u.id].map((name) => ({ id: slug(name), name, universe: u.id })),
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
  return byId.get(id) ?? { id, name: id, universe: 'unknown' };
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
