import { useEffect, useMemo, useState, type CSSProperties, type FormEvent } from 'react';
import { Avatar, AvatarPicker, avatarCharacter } from '../components/Avatar';
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
import { badgesOf, leagueOf, nextLeague } from '../ranking';
import { CountUp } from '../components/Effects';
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
  const [avatar, setAvatar] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  // What happened on the way back from Google, shown in the account section.
  const [signIn, setSignIn] = useState<{ note?: StringKey; error?: StringKey } | null>(null);
  const countries = useMemo(() => countryOptions(lang), [lang]);

  const show = (p: ProfileData) => {
    setProfile(p);
    setName(p.name === 'Player' && p.games === 0 ? '' : p.name);
    setCountry(p.country ?? '');
    setAvatar(avatarCharacter(p.avatar) ?? '');
  };

  useEffect(() => {
    if (!ONLINE_AVAILABLE) return;
    let cancelled = false;
    const load = async () => {
      if (GOOGLE_SIGN_IN) {
        // Coming back from Google: finish the sign-in before showing the profile.
        const account = await import('../online/account');
        if (account.returningFromSignIn()) {
          try {
            const { profile: opened, outcome } = await account.finishGoogleSignIn();
            if (!cancelled) setSignIn({ note: `account.outcome.${outcome}` as StringKey });
            return opened;
          } catch (e) {
            // A failed sign-in must not hide the profile itself.
            if (!cancelled) setSignIn({ error: `error.${toOnlineError(e).code}` as StringKey });
          }
        }
      }
      return getProfile();
    };
    load()
      .then((p) => {
        if (cancelled) return;
        show(p);
        if (p.name !== 'Player') writeStored('ae.name', p.name);
      })
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

  const overall = leagueOf(profile.trophies);
  const peakLeague = leagueOf(profile.peak);
  const daysLeft = (() => {
    const now = new Date();
    const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
    return Math.max(1, Math.ceil((end - now.getTime()) / 86400000));
  })();
  const nameRule = profile?.nameRule ?? 'free';

  const seasonLabel = (season: string | null) => {
    if (!season) return '';
    const [y, m] = season.split('-').map(Number);
    return new Intl.DateTimeFormat(lang, { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, 1));
  };

  return (
    <main className="page">
      <section className="hero-card" style={{ '--league': overall.color } as CSSProperties}>
        <div className="hero-card__top">
          <Avatar value={profile.avatar} size="lg" />
          <div>
            <h1 className="hero-card__name">{profile.name}</h1>
            <p className="hero-card__sub">
              {profile.country && (
                <span>
                  {countryFlag(profile.country)} {countryName(profile.country, lang)}
                </span>
              )}
              <span>#{profile.tag}</span>
            </p>
            {profile.legendAt && (
              <p className="legend-mark">{t('profile.legendSince', { date: shortDate(profile.legendAt, lang) })}</p>
            )}
          </div>
        </div>
        <div className="hero-card__score">
          <div>
            <small>{t('profile.overall')}</small>
            <strong>
              <CountUp to={profile.trophies} />
            </strong>
            <small>
              {profile.rank === null
                ? t('profile.unranked')
                : t('profile.rank', { rank: profile.rank, players: profile.players })}
            </small>
          </div>
          <LeagueEmblem trophies={profile.trophies} />
        </div>
        <p className="hero-card__sub">
          <span>{t('profile.season', { season: seasonLabel(profile.season) })}</span>
          <span>{daysLeft === 1 ? t('profile.season.endsOne') : t('profile.season.ends', { n: daysLeft })}</span>
          <span>{t('profile.overall.hint')}</span>
          <span>{t('profile.season.floor')}</span>
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
        <h2 className="page__subhead">{t('profile.modes')}</h2>
        <ul className="mode-tiles">
          {MODES.map((mode) => {
            const rating = profile.modes.find((m) => m.mode === mode);
            const trophies = rating?.trophies ?? 0;
            const league = leagueOf(trophies);
            const next = nextLeague(trophies);
            const progress = next ? ((trophies - league.from) / (next.league.from - league.from)) * 100 : 100;
            return (
              <li key={mode} className="mode-tile" style={{ '--league': league.color } as CSSProperties}>
                <div className="mode-tile__head">
                  <span className="mode-tile__name">{modeName(mode, t)}</span>
                  <LeagueEmblem trophies={trophies} small />
                </div>
                <span className="mode-tile__trophies">{trophies}</span>
                <span className="mode-tile__league">{t(league.key)}</span>
                <span className="meter" aria-hidden="true">
                  <i style={{ width: `${progress}%` }} />
                </span>
                <span className="mode-tile__meta">
                  {next
                    ? t('profile.mode.next', { n: next.missing, league: t(next.league.key) })
                    : t('profile.mode.top')}
                  {rating && rating.best > 0 && `, ${t('profile.mode.best', { n: rating.best })}`}
                  {rating?.bestRank && `, ${t('profile.mode.bestRank', { n: rating.bestRank })}`}
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h2 className="page__subhead">{t('profile.records')}</h2>
        <dl className="records">
          <div>
            <dt>{t('profile.record.peak')}</dt>
            <dd>{profile.peak}</dd>
          </div>
          <div style={{ '--league': peakLeague.color } as CSSProperties}>
            <dt>{t('profile.record.league')}</dt>
            <LeagueEmblem trophies={profile.peak} small />
            <dd className="mode-tile__league">{t(peakLeague.key)}</dd>
          </div>
          <div>
            <dt>{t('profile.record.rank')}</dt>
            <dd>{profile.bestRank ? `#${profile.bestRank}` : '–'}</dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="page__subhead">{t('profile.history')}</h2>
        {profile.history.length === 0 ? (
          <p className="note">{t('profile.history.empty')}</p>
        ) : (
          <ul className="seasons">
            {profile.history.map((season) => (
              <li key={season.season} style={{ '--league': leagueOf(season.best).color } as CSSProperties}>
                <LeagueEmblem trophies={season.best} small />
                <span>
                  <strong>{seasonLabel(season.season)}</strong>
                  <small>
                    {t('profile.history.row', { trophies: season.trophies, rank: season.rank, players: season.players })}
                  </small>
                </span>
                <span className="recent__delta">{season.best}</span>
              </li>
            ))}
          </ul>
        )}
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
            disabled={nameRule !== 'free'}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <p className="name-rule">
          {nameRule === 'locked'
            ? t('profile.name.locked')
            : nameRule === 'cooldown'
              ? t('profile.name.cooldown', { date: shortDate(profile.nameFreeAt ?? '', lang) })
              : t('profile.name.free')}
        </p>
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
          <AvatarPicker value={avatar} onChange={setAvatar} />
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

      <Account profile={profile} onOpened={show} signIn={signIn} />
      <button type="button" className="btn" onClick={() => navigate('/')}>
        {t('setup.back')}
      </button>
    </main>
  );
}

/** Ways to keep a profile beyond this device: Google, and a recovery code. */
function Account({
  profile,
  onOpened,
  signIn,
}: {
  profile: ProfileData;
  onOpened(profile: ProfileData): void;
  signIn: { note?: StringKey; error?: StringKey } | null;
}) {
  const { t } = useI18n();
  const [code, setCode] = useState<string | null>(null);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<StringKey | null>(null);
  const [opened, setOpened] = useState(false);
  // Second tap needed for the choices that lose something.
  const [confirm, setConfirm] = useState<'fresh' | 'signout' | null>(null);

  useEffect(() => {
    if (!confirm) return;
    const timer = window.setTimeout(() => setConfirm(null), 5000);
    return () => window.clearTimeout(timer);
  }, [confirm]);

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

  const google = (intent: 'link' | 'fresh') => {
    if (intent === 'fresh' && confirm !== 'fresh') return setConfirm('fresh');
    void run(async () => {
      const account = await import('../online/account');
      await account.startGoogleSignIn(intent);
    });
  };

  const signOut = () => {
    if (confirm !== 'signout') return setConfirm('signout');
    setConfirm(null);
    void run(async () => {
      const account = await import('../online/account');
      account.signOutHere();
      onOpened(await getProfile());
    });
  };

  const hasProgress = profile.games > 0;

  return (
    <section className="panel">
      <h2>{t('account.title')}</h2>
      <p className="note">{t('account.intro')}</p>

      {signIn?.note && (
        <p className="note signin-note" role="status">
          {t(signIn.note)}
        </p>
      )}
      {signIn?.error && (
        <p className="alert" role="alert">
          {t(signIn.error)}
        </p>
      )}

      {GOOGLE_SIGN_IN &&
        (profile.saved ? (
          <>
            <p className="note">{t('account.google.saved')}</p>
            <button type="button" className="btn" disabled={busy} onClick={signOut}>
              {t(confirm === 'signout' ? 'account.signout.confirm' : 'account.signout')}
            </button>
            {confirm === 'signout' && <p className="note">{t('account.signout.hint')}</p>}
          </>
        ) : (
          <div className="signin">
            <p className="note">{t(hasProgress ? 'account.guest.progress' : 'account.guest.empty')}</p>
            <button type="button" className="btn btn--primary btn--google" disabled={busy} onClick={() => google('link')}>
              <GoogleMark />
              {t(hasProgress ? 'account.google.link' : 'account.google')}
            </button>
            {hasProgress && (
              <>
                <button type="button" className="btn btn--google" disabled={busy} onClick={() => google('fresh')}>
                  <GoogleMark />
                  {t(confirm === 'fresh' ? 'account.google.fresh.confirm' : 'account.google.fresh')}
                </button>
                <p className={confirm === 'fresh' ? 'alert' : 'note'}>{t('account.google.fresh.hint')}</p>
              </>
            )}
            <p className="note">{t('account.google.existing')}</p>
          </div>
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

/** A shield in the colour of the league these trophies belong to. */
function LeagueEmblem({ trophies, small }: { trophies: number; small?: boolean }) {
  const { t } = useI18n();
  const league = leagueOf(trophies);
  return (
    <span
      className={`emblem${small ? ' emblem--sm' : ''}${league.key === 'league.legend' ? ' emblem--legend' : ''}`}
      style={{ '--league': league.color } as CSSProperties}
      title={t(league.key)}
      aria-hidden="true"
    >
      {t(league.key).replace(/^(Ligue |League )?/, '').replace(/ League$/, '').charAt(0)}
    </span>
  );
}

/** Google's "G", drawn in four colours. */
function GoogleMark() {
  return (
    <svg className="google-mark" viewBox="0 0 48 48" aria-hidden="true" focusable="false">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.5 5.8c4.4-4 6.8-10 6.8-17.2z" />
      <path fill="#FBBC05" d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.8-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.5-5.8c-2.1 1.4-4.8 2.3-8.4 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.8 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}

/** A date as the player reads it, e.g. 19 Dec 2026. */
function shortDate(iso: string, lang: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(lang, { day: 'numeric', month: 'short', year: 'numeric' }).format(date);
}
