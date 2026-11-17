import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AVATARS, Avatar } from '../components/Avatar';
import { countryFlag, countryName, countryOptions } from '../data/countries';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { toOnlineError } from '../online/api';
import { ONLINE_AVAILABLE } from '../online/config';
import { getProfile, updateProfile, type Profile as ProfileData } from '../online/profile';
import { badgesOf, leagueOf, nextLeague } from '../ranking';
import { navigate } from '../router';
import { writeStored } from '../storage';

const OUTCOME: Record<string, StringKey> = {
  win: 'profile.outcome.win',
  loss: 'profile.outcome.loss',
  tie: 'profile.outcome.tie',
};

/** The player's own page: rank, statistics, badges, recent games, and their public identity. */
export function Profile() {
  const { t, lang } = useI18n();
  const [profile, setProfile] = useState<ProfileData | null>(null);
  const [error, setError] = useState<StringKey | null>(null);
  const [name, setName] = useState('');
  const [country, setCountry] = useState('');
  const [avatar, setAvatar] = useState(0);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const countries = useMemo(() => countryOptions(lang), [lang]);

  const show = (p: ProfileData) => {
    setProfile(p);
    setName(p.name === 'Player' && p.games === 0 ? '' : p.name);
    setCountry(p.country ?? '');
    setAvatar(p.avatar);
  };

  useEffect(() => {
    if (!ONLINE_AVAILABLE) return;
    let cancelled = false;
    getProfile()
      .then((p) => !cancelled && show(p))
      .catch((e) => !cancelled && setError(`error.${toOnlineError(e).code}` as StringKey));
    return () => {
      cancelled = true;
    };
  }, []);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (clean.length < 1 || clean.length > 20) return setError('setup.nameRequired');
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      show(await updateProfile(clean, country || null, avatar));
      writeStored('ae.name', clean);
      setSaved(true);
    } catch (err) {
      setError(`error.${toOnlineError(err).code}` as StringKey);
    } finally {
      setSaving(false);
    }
  };

  if (!ONLINE_AVAILABLE || (!profile && error)) {
    return (
      <main className="page">
        <h1 className="display">{t('profile.title')}</h1>
        <p className="alert">{t(error ?? 'online.unavailable')}</p>
        <button type="button" className="btn" onClick={() => navigate('/')}>
          {t('setup.back')}
        </button>
      </main>
    );
  }

  if (!profile) {
    return (
      <main className="page">
        <h1 className="display">{t('profile.title')}</h1>
        <p className="waiting">{t('online.connecting')}</p>
      </main>
    );
  }

  const league = leagueOf(profile.trophies);
  const next = nextLeague(profile.trophies);
  const winRate = profile.games > 0 ? Math.round((profile.wins / profile.games) * 100) : 0;
  const stats: Array<[StringKey, string | number]> = [
    ['profile.stat.games', profile.games],
    ['profile.stat.wins', profile.wins],
    ['profile.stat.losses', profile.losses],
    ['profile.stat.ties', profile.ties],
    ['profile.stat.winRate', `${winRate}%`],
    ['profile.stat.best', profile.best],
    ['profile.stat.streak', profile.streak],
    ['profile.stat.bestStreak', profile.bestStreak],
    ['profile.stat.week', profile.weekGain > 0 ? `+${profile.weekGain}` : profile.weekGain],
    ['profile.stat.forfeits', profile.forfeits],
  ];

  return (
    <main className="page">
      <header className="profile__head">
        <Avatar index={profile.avatar} size="lg" />
        <div>
          <h1 className="display">{profile.name}</h1>
          {profile.country && (
            <p>
              {countryFlag(profile.country)} {countryName(profile.country, lang)}
            </p>
          )}
        </div>
      </header>

      <section className="panel rank" style={{ borderTopColor: league.color }}>
        <p className="rank__league">{t(league.key)}</p>
        <p className="rank__trophies">{t('profile.trophies', { n: profile.trophies })}</p>
        <p className="note">
          {profile.rank === null
            ? t('profile.unranked')
            : t('profile.rank', { rank: profile.rank, players: profile.players })}
          {next && ` ${t('profile.next', { n: next.missing, league: t(next.league.key) })}`}
        </p>
        <div className="form__actions">
          <button type="button" className="btn" onClick={() => navigate('/leaderboard')}>
            {t('home.leaderboard')}
          </button>
          <button type="button" className="btn btn--primary" onClick={() => navigate('/match')}>
            {t('online.match')}
          </button>
        </div>
      </section>

      <section>
        <h2 className="page__subhead">{t('profile.stats')}</h2>
        <dl className="stats">
          {stats.map(([key, value]) => (
            <div key={key}>
              <dt>{t(key)}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h2 className="page__subhead">{t('profile.badges')}</h2>
        <ul className="badges">
          {badgesOf(profile).map((badge) => (
            <li key={badge.key} className={badge.earned ? 'badge badge--earned' : 'badge'}>
              {t(badge.key)}
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="page__subhead">{t('profile.recent')}</h2>
        {profile.recent.length === 0 ? (
          <p className="note">{t('profile.recent.empty')}</p>
        ) : (
          <ul className="recent">
            {profile.recent.map((match, i) => (
              <li key={`${match.at}-${i}`} className={`recent__${match.outcome}`}>
                <strong>{t(OUTCOME[match.outcome])}</strong>
                <span>{t('profile.versus', { name: match.opponent })}</span>
                <span className="recent__delta">{match.delta > 0 ? `+${match.delta}` : match.delta}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <form className="panel" onSubmit={save} noValidate>
        <h2>{t('profile.edit')}</h2>
        <label className="field">
          <span>{t('setup.name')}</span>
          <input
            type="text"
            value={name}
            maxLength={20}
            autoComplete="nickname"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('profile.country')}</span>
          <select value={country} onChange={(e) => setCountry(e.target.value)}>
            <option value="">{t('profile.country.none')}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="field">
          <legend>{t('profile.avatar')}</legend>
          <div className="avatars">
            {AVATARS.map((_, index) => (
              <label key={index} className="avatars__choice">
                <input
                  type="radio"
                  name="avatar"
                  checked={avatar === index}
                  onChange={() => setAvatar(index)}
                  aria-label={`${t('profile.avatar')} ${index + 1}`}
                />
                <Avatar index={index} />
              </label>
            ))}
          </div>
        </fieldset>
        {error && (
          <p className="alert" role="alert">
            {t(error)}
          </p>
        )}
        {saved && <p className="note">{t('profile.saved')}</p>}
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {t('profile.save')}
        </button>
      </form>

      <p className="note">{t('profile.device')}</p>
      <button type="button" className="btn" onClick={() => navigate('/')}>
        {t('setup.back')}
      </button>
    </main>
  );
}
