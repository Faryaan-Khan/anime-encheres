import { useEffect, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { countryFlag, countryName } from '../data/countries';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { toOnlineError } from '../online/api';
import { ONLINE_AVAILABLE } from '../online/config';
import { getLeaderboard, getProfile, type Leaderboard as Board } from '../online/profile';
import { navigate } from '../router';

type Tab = 'world' | 'week' | 'country';

/** World ranking, this week's climbers, and the ranking of the player's own country. */
export function Leaderboard() {
  const { t, lang } = useI18n();
  const [tab, setTab] = useState<Tab>('world');
  const [country, setCountry] = useState<string | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<StringKey | null>(null);

  useEffect(() => {
    if (!ONLINE_AVAILABLE) return;
    getProfile()
      .then((p) => setCountry(p.country))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!ONLINE_AVAILABLE) return;
    let cancelled = false;
    setBoard(null);
    setError(null);
    getLeaderboard(tab === 'week' ? 'week' : 'all', tab === 'country' ? country : null)
      .then((b) => !cancelled && setBoard(b))
      .catch((e) => !cancelled && setError(`error.${toOnlineError(e).code}` as StringKey));
    return () => {
      cancelled = true;
    };
  }, [tab, country]);

  const tabs: Array<{ id: Tab; label: string; disabled?: boolean }> = [
    { id: 'world', label: t('board.tab.world') },
    { id: 'week', label: t('board.tab.week') },
    {
      id: 'country',
      label: country ? `${countryFlag(country)} ${countryName(country, lang)}` : t('board.tab.country'),
      disabled: !country,
    },
  ];

  return (
    <main className="page">
      <h1 className="display">{t('home.leaderboard')}</h1>

      {!ONLINE_AVAILABLE ? (
        <p className="alert">{t('online.unavailable')}</p>
      ) : (
        <>
          <div className="options" role="tablist">
            {tabs.map((item) => (
              <label key={item.id} className="option">
                <input
                  type="radio"
                  name="leaderboard"
                  checked={tab === item.id}
                  disabled={item.disabled}
                  onChange={() => setTab(item.id)}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
          {!country && <p className="note">{t('board.country.hint')}</p>}
          {tab === 'week' && <p className="note">{t('board.week.hint')}</p>}

          {error && (
            <p className="alert" role="alert">
              {t(error)}
            </p>
          )}
          {!board && !error && <p className="waiting">{t('online.connecting')}</p>}
          {board && board.rows.length === 0 && <p className="waiting">{t('board.empty')}</p>}
          {board && board.rows.length > 0 && (
            <ol className="leaders">
              {board.rows.map((row) => (
                <li key={row.rank} className={row.you ? 'leaders__row leaders__row--you' : 'leaders__row'}>
                  <span className="leaders__rank">{row.rank}</span>
                  <Avatar index={row.avatar} size="sm" />
                  <span className="leaders__name">
                    {row.country && <span title={countryName(row.country, lang)}>{countryFlag(row.country)} </span>}
                    {row.name}
                  </span>
                  <span className="leaders__value">
                    {tab === 'week' && row.value > 0 ? `+${row.value}` : row.value}
                  </span>
                </li>
              ))}
            </ol>
          )}
          {board?.me && board.me.rank > board.rows.length && (
            <p className="note">{t('board.you', { rank: board.me.rank, total: board.total })}</p>
          )}
        </>
      )}

      <div className="form__actions">
        <button type="button" className="btn" onClick={() => navigate('/')}>
          {t('setup.back')}
        </button>
        <button type="button" className="btn btn--primary" onClick={() => navigate('/profile')}>
          {t('home.profile')}
        </button>
      </div>
    </main>
  );
}
