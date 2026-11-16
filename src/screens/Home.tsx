import { CharacterCard } from '../components/CharacterCard';
import { useI18n } from '../i18n';
import { hasSavedLocalGame } from '../local/useLocalGame';
import { navigate } from '../router';
import { removeStored } from '../storage';

export function Home() {
  const { t, money } = useI18n();
  const resumable = hasSavedLocalGame();

  return (
    <main className="home">
      <section className="hero">
        <div className="hero__card" aria-hidden="true">
          <CharacterCard id={null} />
          <span className="sticker">{money(500)}</span>
        </div>
        <h1 className="hero__title display">
          Enchères
          <br />
          Animés
        </h1>
        <p className="hero__tagline">{t('app.tagline')}</p>
      </section>

      <nav className="home__modes">
        {resumable && (
          <button type="button" className="btn btn--wide" onClick={() => navigate('/local')}>
            {t('home.resume')}
          </button>
        )}
        <button
          type="button"
          className="btn btn--primary btn--mode"
          onClick={() => {
            // A new game replaces any unfinished one.
            removeStored('ae.local');
            navigate('/local');
          }}
        >
          {t('home.local')}
          <small>{t('home.local.hint')}</small>
        </button>
        <button type="button" className="btn btn--mode" onClick={() => navigate('/online')}>
          {t('home.online')}
          <small>{t('home.online.hint')}</small>
        </button>
        <button type="button" className="link" onClick={() => navigate('/rules')}>
          {t('home.rules')}
        </button>
      </nav>
    </main>
  );
}
