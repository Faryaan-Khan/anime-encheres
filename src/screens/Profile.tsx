import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { AVATARS, Avatar } from '../components/Avatar';
import { countryFlag, countryName, countryOptions } from '../data/countries';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { toOnlineError } from '../online/api';
import { GOOGLE_SIGN_IN, ONLINE_AVAILABLE } from '../online/config';
import {
  getProfile,
  newRecoveryCode,
  redeemRecoveryCode,
  updateProfile,
  type Profile as ProfileData,
} from '../online/profile';
import { MODES } from '../match/config';
import { modeName } from '../modes';
import { badgesOf, leagueOf } from '../ranking';
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
    const load = async () => {
      if (GOOGLE_SIGN_IN) {
        // Coming back from Google: finish the sign-in before showing the profile.
        const account = await import('../online/account');
        if (account.returningFromSignIn()) return account.finishGoogleSignIn();
      }
      return getProfile();
    };
    load()
      .then((p) => !cancelled && show(p))
      .catch(async (e) => {
        if (cancelled) return;
        setError(`error.${toOnlineError(e).code}` as StringKey);
        // A failed sign-in must not hide the profile itself.
        if (GOOGLE_SIGN_IN) await getProfile().then((p) => !cancelled && show(p)).catch(() => undefined);
      });
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

  if (!ONLINE_AVAILABLE || (!profile && error && error !== 'error.ALREADY_LINKED')) {
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

  const trophiesIn = (mode: string) => profile.modes.find((m) => m.mode === mode)?.trophies ?? 0;
  const winRate = profile.games > 0 ? Math.round((profile.wins / profile.games) * 100) : 0;
  const stats: Array<[StringKey, string | number]> = [
    ['profile.stat.games', profile.games],
    ['profile.stat.wins', profile.wins],
    ['profile.stat.losses', profile.losses],
    ['profile.stat.ties', profile.ties],
    ['profile.stat.winRate', `${winRate}%`],
    ['profile.stat.best', profile.peak],
    ['profile.stat.streak', profile.streak],
    ['profile.stat.bestStreak', profile.bestStreak],
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

      <section className="panel rank">
        <p className="rank__league">{t('profile.overall')}</p>
        <p className="rank__trophies">{profile.trophies}</p>
        <p className="note">
          {profile.rank === null
            ? t('profile.unranked')
            : t('profile.rank', { rank: profile.rank, players: profile.players })}{' '}
          {t('profile.overall.hint')}
        </p>
        <p className="note">{t('profile.tag', { tag: profile.tag })}</p>
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
        <h2 className="page__subhead">{t('profile.modes')}</h2>
        <ul className="recent">
          {MODES.map((mode) => {
            const league = leagueOf(trophiesIn(mode));
            return (
              <li key={mode} style={{ borderLeftColor: league.color }}>
                <strong>{modeName(mode, t)}</strong>
                <span>{t(league.key)}</span>
                <span className="recent__delta">{trophiesIn(mode)}</span>
              </li>
            );
          })}
        </ul>
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
            <li key={badge.key} className={badge.level > 0 ? 'badge badge--earned' : 'badge'}>
              <strong>{t(badge.key)}</strong>
              <span className="badge__pips" aria-hidden="true">
                {Array.from({ length: badge.levels }, (_, i) => (
                  <i key={i} className={i < badge.level ? 'on' : undefined} />
                ))}
              </span>
              <span className="badge__note">
                {badge.level > 0 && `${t('badge.level', { n: badge.level })}, `}
                {badge.reached !== null && `${t('badge.reached', { n: badge.reached })}, `}
                {badge.next === null
                  ? t('badge.top')
                  : t(badge.level > 0 ? 'badge.next' : 'badge.first', { n: badge.next })}
              </span>
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
                <span>
                  {t('profile.versus', { name: match.opponent })}
                  {match.mode && `, ${modeName(match.mode, t)}`}
                </span>
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

      <Account profile={profile} onOpened={show} />
      <button type="button" className="btn" onClick={() => navigate('/')}>
        {t('setup.back')}
      </button>
    </main>
  );
}

/** Ways to keep a profile beyond this device: a recovery code, and Google when it is set up. */
function Account({ profile, onOpened }: { profile: ProfileData; onOpened(profile: ProfileData): void }) {
  const { t } = useI18n();
  const [code, setCode] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StringKey | null>(null);
  const [opened, setOpened] = useState(false);

  const run = async (task: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setOpened(false);
    try {
      await task();
    } catch (err) {
      setError(`error.${toOnlineError(err).code}` as StringKey);
    } finally {
      setBusy(false);
    }
  };

  const getCode = () => run(async () => setCode(await newRecoveryCode()));

  const useCode = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      const found = await redeemRecoveryCode(typed);
      if (!found) return setError('account.code.wrong');
      // Read it again through this device, which now opens that profile.
      onOpened(await getProfile());
      writeStored('ae.name', found.name);
      setTyped('');
      setCode(null);
      setOpened(true);
    });
  };

  const google = () =>
    run(async () => {
      const account = await import('../online/account');
      await account.startGoogleSignIn();
    });

  return (
    <section className="panel">
      <h2>{t('account.title')}</h2>
      <p className="note">{t('account.intro')}</p>

      {GOOGLE_SIGN_IN &&
        (profile.saved ? (
          <p className="note">{t('account.google.saved')}</p>
        ) : (
          <button type="button" className="btn btn--primary" disabled={busy} onClick={google}>
            {t('account.google')}
          </button>
        ))}

      {code ? (
        <>
          <p className="code" aria-live="polite">
            {code}
          </p>
          <p className="note">{t('account.code.shown')}</p>
        </>
      ) : (
        <button type="button" className="btn" disabled={busy} onClick={getCode}>
          {t(profile.hasCode ? 'account.code.renew' : 'account.code.get')}
        </button>
      )}

      <form className="form" onSubmit={useCode} noValidate>
        <label className="field">
          <span>{t('account.code.label')}</span>
          <input
            type="text"
            value={typed}
            maxLength={40}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="XXXX-XXXX-XXXX-XXXX"
            onChange={(e) => setTyped(e.target.value)}
          />
        </label>
        <p className="note">{t('account.code.replace')}</p>
        {error && (
          <p className="alert" role="alert">
            {t(error)}
          </p>
        )}
        {opened && <p className="note">{t('account.code.done')}</p>}
        <button type="submit" className="btn" disabled={busy || typed.trim().length < 16}>
          {t('account.code.use')}
        </button>
      </form>
    </section>
  );
}
