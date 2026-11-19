import { useEffect, useState } from 'react';
import { Avatar } from '../components/Avatar';
import { countryFlag, countryName } from '../data/countries';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { RATINGS } from '../match/config';
import { modeName } from '../modes';
import { toOnlineError } from '../online/api';
import { ONLINE_AVAILABLE } from '../online/config';
import { getLeaderboard, getProfile, type Leaderboard as Board, type LeaderboardRow } from '../online/profile';
import { navigate } from '../router';

type Audience = 'world' | 'friends' | 'country';
const OVERALL = 'overall';

/**
 * One ranking per mode, plus the overall score. Each can be narrowed to the
 * player's friends or to their country.
 */
export function Leaderboard() {
  const { t, lang } = useI18n();
  const [scope, setScope] = useState<string>(OVERALL);
  const [audience, setAudience] = useState<Audience>('world');
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
    getLeaderboard(scope, audience === 'country' ? country : null, audience === 'friends')
      .then((b) => !cancelled && setBoard(b))
      .catch((e) => !cancelled && setError(`error.${toOnlineError(e).code}` as StringKey));
    return () => {
      cancelled = true;
    };
  }, [scope, audience, country]);

  const audiences: Array<{ id: Audience; label: string; disabled?: boolean }> = [
    { id: 'world', label: t('board.tab.world') },
    { id: 'friends', label: t('board.tab.friends') },
    {
      id: 'country',
      label: country ? `${countryFlag(country)} ${countryName(country, lang)}` : t('board.tab.country'),
      disabled: !country,
    },
  ];

  const myRow = board?.rows.find((row) => row.you) ?? null;
  const jumpToMe = () =>
    document.querySelector('.leaders__row--you')?.scrollIntoView({ behavior: 'smooth', block: 'center' });

  return (
    <main className="page">
      <h1 className="display">{t('home.leaderboard')}</h1>

      {!ONLINE_AVAILABLE ? (
        <p className="alert">{t('online.unavailable')}</p>
      ) : (
        <>
          <label className="field">
            <span>{t('board.scope')}</span>
            <select value={scope} onChange={(e) => setScope(e.target.value)}>
              <option value={OVERALL}>{t('board.overall')}</option>
              {RATINGS.map((id) => (
                <option key={id} value={id}>
                  {modeName(id, t)}
                </option>
              ))}
            </select>
          </label>
          <div className="options" role="tablist">
            {audiences.map((item) => (
              <label key={item.id} className="option">
                <input
                  type="radio"
                  name="audience"
                  checked={audience === item.id}
                  disabled={item.disabled}
                  onChange={() => setAudience(item.id)}
                />
                <span>{item.label}</span>
              </label>
            ))}
          </div>
          {scope === OVERALL && <p className="note">{t('board.overall.hint')}</p>}
          {!country && <p className="note">{t('board.country.hint')}</p>}

          {error && (
            <p className="alert" role="alert">
              {t(error)}
            </p>
          )}
          {!board && !error && <p className="waiting">{t('online.connecting')}</p>}
          {board && board.rows.length === 0 && (
            <p className="waiting">{t(audience === 'friends' ? 'board.empty.friends' : 'board.empty')}</p>
          )}
          {board && board.rows.length > 0 && (
            <>
              {myRow && board.me && board.me.rank > 10 && (
                <button type="button" className="link leaders__jump" onClick={() => jumpToMe()}>
                  {t('board.jump', { rank: board.me.rank })}
                </button>
              )}
              <ol className="leaders">
                {board.rows.map((row) => (
                  <LeaderRow key={row.rank} row={row} />
                ))}
                {(board.around ?? []).length > 0 && (
                  <>
                    <li className="leaders__gap" aria-hidden="true">
                      ⋮
                    </li>
                    {board.around!.map((row) => (
                      <LeaderRow key={`around-${row.rank}`} row={row} />
                    ))}
                  </>
                )}
              </ol>
              {board.me && !myRow && (board.around ?? []).length === 0 && (
                <p className="note">{t('board.you', { rank: board.me.rank, total: board.total })}</p>
              )}
            </>
          )}
        </>
      )}

      <div className="form__actions">
        <button type="button" className="btn" onClick={() => navigate('/')}>
          {t('setup.back')}
        </button>
        <button type="button" className="btn btn--primary" onClick={() => navigate('/friends')}>
          {t('home.friends')}
        </button>
      </div>
    </main>
  );
}

/** One line of a ranking. */
function LeaderRow({ row }: { row: LeaderboardRow }) {
  const { lang } = useI18n();
  return (
    <li className={row.you ? 'leaders__row leaders__row--you' : 'leaders__row'}>
      <span className="leaders__rank">{row.rank}</span>
      <Avatar value={row.avatar} size="sm" />
      <span className="leaders__name">
        {row.country && <span title={countryName(row.country, lang)}>{countryFlag(row.country)} </span>}
        {row.name}
      </span>
      <span className="leaders__value">{row.value}</span>
    </li>
  );
}
