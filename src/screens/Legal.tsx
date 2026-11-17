import { CharacterCard } from '../components/CharacterCard';
import { CHARACTERS, rarityOf, type Rarity } from '../data/characters';
import { useI18n } from '../i18n';
import { navigate } from '../router';

const RARITIES: Rarity[] = ['common', 'rare', 'epic', 'legendary', 'mythic', 'apex'];

/** Fan-project notice, how pictures and ratings are handled, and how rights holders reach us. */
export function Legal() {
  const { t } = useI18n();
  const samples = RARITIES.map((r) => CHARACTERS.find((c) => c.universe === 'one-piece' && rarityOf(c) === r)).filter(
    (c): c is (typeof CHARACTERS)[number] => Boolean(c),
  );

  return (
    <main className="page prose">
      <h1 className="display">{t('legal.title')}</h1>

      <h2>{t('legal.fan.title')}</h2>
      <p>{t('legal.fan')}</p>

      <h2>{t('legal.art.title')}</h2>
      <p>{t('legal.art')}</p>

      <h2>{t('rarity.title')}</h2>
      <p>{t('rarity.hint')}</p>
      <div className="legend-rarity">
        {RARITIES.map((r) => (
          <span key={r} className={`rarity--${r}`}>
            {t(`rarity.${r}`)}
          </span>
        ))}
      </div>
      <ul className="team__cards">
        {samples.map((c) => (
          <li key={c.id}>
            <CharacterCard id={c.id} size="sm" />
          </li>
        ))}
      </ul>

      <h2>{t('legal.ratings.title')}</h2>
      <p>{t('legal.ratings')}</p>

      <h2>{t('legal.rights.title')}</h2>
      <p>{t('legal.rights')}</p>
      <button type="button" className="btn" onClick={() => navigate('/feedback?topic=rights')}>
        {t('legal.rights.action')}
      </button>

      <h2>{t('legal.data.title')}</h2>
      <p>{t('legal.data')}</p>

      <button type="button" className="btn" onClick={() => navigate('/')}>
        {t('setup.back')}
      </button>
    </main>
  );
}
