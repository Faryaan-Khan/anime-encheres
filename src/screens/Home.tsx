import { CharacterCard } from '../components/CharacterCard';
import { useI18n } from '../i18n';
import { hasSavedLocalGame } from '../local/useLocalGame';
import { navigate } from '../router';
import { removeStored } from '../storage';

export function Home() {
  const { t, money } = useI18n();
  const resumable = hasSavedLocalGame();
  // Starting a new game replaces any unfinished one.
  const newGame = (path: string) => {
    removeStored('ae.local');
    navigate(path);
  };

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
        <button type="button" className="btn btn--primary btn--mode" onClick={() => newGame('/local')}>
          {t('home.local')}
          <small>{t('home.local.hint')}</small>
        </button>
        <button type="button" className="btn btn--mode" onClick={() => newGame('/solo')}>
          {t('home.solo')}
          <small>{t('home.solo.hint')}</small>
        </button>
        <button type="button" className="btn btn--mode" onClick={() => navigate('/online')}>
          {t('home.online')}
          <small>{t('home.online.hint')}</small>
        </button>
        <div className="home__links">
          <button type="button" className="link" onClick={() => navigate('/profile')}>
            {t('home.profile')}
          </button>
          <button type="button" className="link" onClick={() => navigate('/leaderboard')}>
            {t('home.leaderboard')}
          </button>
          <button type="button" className="link" onClick={() => navigate('/rules')}>
            {t('home.rules')}
          </button>
          <button type="button" className="link" onClick={() => navigate('/feedback')}>
            {t('home.feedback')}
          </button>
        </div>
      </nav>
    </main>
  );
}
