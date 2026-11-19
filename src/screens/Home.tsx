import { useEffect, useState } from 'react';
import { CharacterCard } from '../components/CharacterCard';
import { useI18n } from '../i18n';
import { hasSavedLocalGame } from '../local/useLocalGame';
import { ONLINE_AVAILABLE } from '../online/config';
import { getFriends, type Friends } from '../online/profile';
import { navigate } from '../router';
import { removeStored } from '../storage';

export function Home() {
  const { t, money } = useI18n();
  const resumable = hasSavedLocalGame();
  const [invites, setInvites] = useState<Friends['invites']>([]);
  const [requests, setRequests] = useState(0);

  // A friend may be waiting in a private room: show their invitation here.
  useEffect(() => {
    if (!ONLINE_AVAILABLE) return;
    let cancelled = false;
    const load = () =>
      getFriends()
        .then((f) => {
          if (cancelled) return;
          setInvites(f.invites);
          setRequests(f.incoming.length);
        })
        .catch(() => undefined);
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, 15000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, []);
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
          {t('app.title')
            .split(' ')
            .map((word, i) => (
              <span key={i}>
                {i > 0 && <br />}
                {word}
              </span>
            ))}
        </h1>
        <p className="hero__tagline">{t('app.tagline')}</p>
      </section>

      <nav className="home__modes">
        {invites.map((invite) => (
          <button
            key={invite.code}
            type="button"
            className="btn btn--wide invite"
            onClick={() => navigate(`/room/${invite.code}`)}
          >
            {t('home.invite', { name: invite.from })}
          </button>
        ))}
        <button type="button" className="btn btn--primary btn--mode" onClick={() => navigate('/online')}>
          {t('home.online')}
          <small>{t('home.online.hint')}</small>
        </button>
        <button type="button" className="btn btn--mode" onClick={() => newGame('/local')}>
          {t('home.offline')}
          <small>{t('home.offline.hint')}</small>
        </button>
        {resumable && (
          <button type="button" className="btn btn--wide" onClick={() => navigate('/local')}>
            {t('home.resume')}
          </button>
        )}
        <div className="home__links">
          <button type="button" className="link" onClick={() => navigate('/profile')}>
            {t('home.profile')}
          </button>
          <button type="button" className="link" onClick={() => navigate('/leaderboard')}>
            {t('home.leaderboard')}
          </button>
          <button type="button" className="link" onClick={() => navigate('/friends')}>
            {t('home.friends')}
            {/* Friend requests waiting: a count on the link. */}
            {requests > 0 && (
              <span className="count-badge" aria-label={t('friends.incoming.count', { n: requests })}>
                {requests}
              </span>
            )}
          </button>
          <button type="button" className="link" onClick={() => navigate('/rules')}>
            {t('home.rules')}
          </button>
          <button type="button" className="link" onClick={() => navigate('/characters')}>
            {t('home.characters')}
          </button>
          <button type="button" className="link" onClick={() => navigate('/feedback')}>
            {t('home.feedback')}
          </button>
        </div>
      </nav>
    </main>
  );
}
