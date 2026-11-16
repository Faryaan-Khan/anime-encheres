/**
 * Rebuilds docs/POWER_RATINGS.md and docs/power-ratings.csv from
 * src/data/rosters.json. Run with `npm run ratings` after editing ratings.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const rosters = JSON.parse(read('../src/data/rosters.json'));

const UNIVERSES = {
  'dragon-ball': 'Dragon Ball',
  'one-piece': 'One Piece',
  naruto: 'Naruto',
  'jujutsu-kaisen': 'Jujutsu Kaisen',
  bleach: 'Bleach',
  'hunter-x-hunter': 'Hunter × Hunter',
  'demon-slayer': 'Demon Slayer',
};

// Keep in sync with tierOf() in src/data/characters.ts.
function tier(power, top) {
  const ratio = power / top;
  if (ratio >= 0.93) return 'S';
  if (ratio >= 0.82) return 'A';
  if (ratio >= 0.66) return 'B';
  if (ratio >= 0.45) return 'C';
  return 'D';
}

const rows = [];
for (const [id, name] of Object.entries(UNIVERSES)) {
  const top = Math.max(...rosters[id].map(([, power]) => power));
  rosters[id].forEach(([character, power, note], index) => {
    rows.push({ universe: name, rank: index + 1, character, power, tier: tier(power, top), note });
  });
}

const csvCell = (value) => `"${String(value).replaceAll('"', '""')}"`;
const csv = [
  ['Universe', 'Rank', 'Character', 'Power', 'Tier', 'Why'].join(','),
  ...rows.map((r) => [r.universe, r.rank, r.character, r.power, r.tier, r.note].map(csvCell).join(',')),
].join('\n');
writeFileSync(new URL('../docs/power-ratings.csv', import.meta.url), `${csv}\n`);

const intro = read('./ratings-intro.md').trimEnd();
const summary = Object.entries(UNIVERSES).map(([id, name]) => {
  const own = rows.filter((r) => r.universe === name);
  const count = (t) => own.filter((r) => r.tier === t).length;
  const powers = rosters[id].map(([, power]) => power);
  return `| ${name} | ${own.length} | ${Math.max(...powers)} | ${Math.min(...powers)} | ${count('S')} | ${count('A')} | ${count('B')} | ${count('C')} | ${count('D')} |`;
});
const sections = Object.values(UNIVERSES).map((name) => {
  const own = rows.filter((r) => r.universe === name);
  return [
    `## ${name}`,
    '',
    '| # | Character | Power | Tier | Why |',
    '| --- | --- | --- | --- | --- |',
    ...own.map((r) => `| ${r.rank} | ${r.character} | ${r.power} | ${r.tier} | ${r.note} |`),
  ].join('\n');
});

const markdown = [
  intro,
  '',
  '## Roster sizes',
  '',
  '| Universe | Characters | Strongest | Weakest | S | A | B | C | D |',
  '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
  ...summary,
  `| **Total** | **${rows.length}** | | | | | | | |`,
  '',
  ...sections.flatMap((s) => [s, '']),
].join('\n');
writeFileSync(new URL('../docs/POWER_RATINGS.md', import.meta.url), markdown);

console.log(`Wrote ${rows.length} ratings to docs/POWER_RATINGS.md and docs/power-ratings.csv`);
