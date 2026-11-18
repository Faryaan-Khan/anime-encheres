import { useMemo, useState, type CSSProperties } from 'react';
import { CharacterCard } from '../components/CharacterCard';
import {
  ALL_SCALE,
  CHARACTERS,
  UNIVERSES,
  getUniverse,
  powerIn,
  tierOf,
  type Character,
} from '../data/characters';
import { useI18n } from '../i18n';
import { navigate } from '../router';

/**
 * Every character and how strong they are, with the reason for the rating.
 * "All" ranks everyone on the shared scale used in mixed games; a universe
 * ranks its own characters on that universe's 0–100 scale, which is what
 * players see in a game of that universe.
 */
export function Characters() {
  const { t } = useI18n();
  const [scale, setScale] = useState<string>(ALL_SCALE);
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const own = scale === ALL_SCALE ? CHARACTERS : CHARACTERS.filter((c) => c.universe === scale);
    const ranked = own
      .slice()
      .sort((a, b) => b.power - a.power || a.name.localeCompare(b.name))
      .map((character, index) => ({ character, rank: index + 1 }));
    return needle ? ranked.filter(({ character }) => character.name.toLowerCase().includes(needle)) : ranked;
  }, [scale, query]);

  const choices = [{ id: ALL_SCALE, name: t('chars.all') }, ...UNIVERSES.map((u) => ({ id: u.id, name: u.name }))];

  return (
    <main className="page chars">
      <h1 className="display">{t('chars.title')}</h1>
      <p className="lede">{t(scale === ALL_SCALE ? 'chars.hint.all' : 'chars.hint.one', { name: getUniverse(scale)?.name ?? '' })}</p>

      <div className="chars__filters" role="tablist" aria-label={t('chars.filter')}>
        {choices.map((choice) => (
          <button
            key={choice.id}
            type="button"
            role="tab"
            aria-selected={scale === choice.id}
            className={`chip${scale === choice.id ? ' chip--on' : ''}`}
            style={
              choice.id === ALL_SCALE ? undefined : ({ '--spot': getUniverse(choice.id).color } as CSSProperties)
            }
            onClick={() => setScale(choice.id)}
          >
            {choice.name}
          </button>
        ))}
      </div>

      <label className="field chars__search">
        <span className="sr-only">{t('chars.search')}</span>
        <input
          type="search"
          value={query}
          placeholder={t('chars.search')}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>

      <p className="note">{t('chars.count', { n: rows.length })}</p>

      <ol className="chars__list">
        {rows.map(({ character, rank }) => (
          <CharacterRow key={character.id} character={character} rank={rank} scale={scale} />
        ))}
      </ol>

      <div className="form__actions">
        <button type="button" className="btn" onClick={() => navigate('/')}>
          {t('setup.back')}
        </button>
      </div>
    </main>
  );
}

function CharacterRow({ character, rank, scale }: { character: Character; rank: number; scale: string }) {
  const { t } = useI18n();
  const universe = getUniverse(character.universe);
  const own = powerIn(character, character.universe);
  const shown = scale === ALL_SCALE ? character.power : own;
  return (
    <li className="chars__row" style={{ '--spot': universe.color } as CSSProperties}>
      <span className="chars__rank">{rank}</span>
      <CharacterCard id={character.id} size="sm" />
      <div className="chars__text">
        <h2 className="chars__name">{character.name}</h2>
        <p className="chars__meta">
          <span className="chars__universe">{universe.name}</span>
          <span className={`chars__tier tier--${tierOf(character)}`}>{t('chars.tier', { tier: tierOf(character) })}</span>
        </p>
        <p className="chars__why">{character.note}</p>
      </div>
      <div className="chars__power">
        <strong>{shown}</strong>
        <span>
          {scale === ALL_SCALE
            ? t('chars.inUniverse', { n: own, name: universe.name })
            : t('chars.overall', { n: character.power })}
        </span>
      </div>
    </li>
  );
}
