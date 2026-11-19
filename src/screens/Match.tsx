import { BackButton } from '../components/BackButton';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useNow } from '../hooks';
import { play } from '../sound';
import { MIX_ID } from '../data/characters';
import { useI18n } from '../i18n';
import { MATCH_SETTINGS, MODES, TRIO, isQueue, trioQueue, trioVerse } from '../match/config';
import { modeName } from '../modes';
import { findMatch, findTrio, leaveQueue, resign } from '../online/api';
import { ONLINE_AVAILABLE } from '../online/config';
import { getProfile, type Profile } from '../online/profile';
import { leagueOf } from '../ranking';
import { navigate } from '../router';
import { readStored, removeStored, writeStored } from '../storage';
import { ConnectedRoom } from './Room';

const SESSION_KEY = 'ae.match';
const MODE_KEY = 'ae.mode';
const POLL_MS = 2500;

/** The match in progress, kept so that a reload returns to it. */
function loadSession(): string | null {
  try {
    const session = JSON.parse(readStored(SESSION_KEY) ?? 'null') as { kind?: string; code?: string } | null;
    return session?.kind === 'online' && typeof session.code === 'string' ? session.code : null;
  } catch {
    return null;
  }
}

/**
 * Quick match: choose a mode, look for an opponent, then play. The server
 * decides who sits in the other seat; this screen only waits for the game.
 */
export function Match() {
  const { t } = useI18n();
  const [code, setCodeState] = useState<string | null>(loadSession);
  const [name, setName] = useState(() => readStored('ae.name') ?? '');
  const [mode, setMode] = useState(() => {
    const stored = readStored(MODE_KEY);
    return isQueue(stored) ? stored : MIX_ID;
  });
  const [searching, setSearching] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const idle = code === null && !searching;

  // Refreshed whenever the player is back on this screen, so trophies are current.
  useEffect(() => {
    if (!ONLINE_AVAILABLE || !idle) return;
    let cancelled = false;
    getProfile()
      .then((p) => {
        if (cancelled) return;
        setProfile(p);
        // A name that may not change right now is the one the match uses.
        if (p.nameRule && p.nameRule !== 'free') setName(p.name);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [idle]);

  const setCode = (next: string | null) => {
    setCodeState(next);
    if (next) writeStored(SESSION_KEY, JSON.stringify({ kind: 'online', code: next }));
    else removeStored(SESSION_KEY);
  };
  const exit = () => {
    setCode(null);
    navigate('/');
  };
  const findAnother = (next?: string) => {
    if (next && isQueue(next)) {
      setMode(next);
      writeStored(MODE_KEY, next);
    }
    setCode(null);
    setSearching(true);
  };

  if (code) {
    return <ConnectedRoom key={code} code={code} matched={{ onExit: exit, onFindAnother: findAnother, mode }} />;
  }

  if (!ONLINE_AVAILABLE) {
    return (
      <main className="page">
        <h1 className="display">{t('match.title')}</h1>
        <p className="alert">{t('online.unavailable')}</p>
        <button type="button" className="btn" onClick={() => navigate('/local')}>
          {t('home.offline')}
        </button>
      </main>
    );
  }

  if (searching) {
    return (
      <Searching
        name={name.trim()}
        mode={mode}
        onFound={(found) => {
          play('found');
          setSearching(false);
          setCode(found);
        }}
        onCancel={() => setSearching(false)}
      />
    );
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (clean.length < 1 || clean.length > 20) return setInvalid(true);
    setInvalid(false);
    writeStored('ae.name', clean);
    writeStored(MODE_KEY, mode);
    setSearching(true);
  };

  const trophiesIn = (id: string) => profile?.modes.find((m) => m.mode === id)?.trophies ?? 0;
  // The queue is a 1v1 mode, or `trio:<mode>` for 1v1v1 in that universe.
  const verse = trioVerse(mode);
  const three = verse !== null;
  const universe = verse ?? mode;

  return (
    <main className="page">
      <h1 className="display">{t('match.title')}</h1>
      <p>{t('match.rules')}</p>
      <form className="form" onSubmit={submit} noValidate>
        <fieldset className="field">
          <legend>{t('match.format')}</legend>
          <div className="options">
            {[false, true].map((trio) => (
              <label key={String(trio)} className="option">
                <input
                  type="radio"
                  name="format"
                  checked={three === trio}
                  onChange={() => setMode(trio ? trioQueue(universe) : universe)}
                />
                <span>{t(trio ? 'match.format.trio' : 'match.format.duel')}</span>
              </label>
            ))}
          </div>
          {three && (
            <small className="note">
              {t('match.format.trio.hint')}{' '}
              {t('match.level', { league: t(leagueOf(trophiesIn(TRIO)).key), n: trophiesIn(TRIO) })}
            </small>
          )}
        </fieldset>
        <fieldset className="field">
          <legend>{t('match.mode')}</legend>
          <div className="modes">
            {MODES.map((id) => (
              <label key={id} className="modes__choice">
                <input
                  type="radio"
                  name="mode"
                  checked={universe === id}
                  onChange={() => setMode(three ? trioQueue(id) : id)}
                />
                <span>
                  <strong>{modeName(id, t)}</strong>
                  <small>
                    {three
                      ? t('online.format.trio')
                      : t('match.level', { league: t(leagueOf(trophiesIn(id)).key), n: trophiesIn(id) })}
                  </small>
                </span>
              </label>
            ))}
          </div>
          <small className="note">{t('match.mode.hint')}</small>
        </fieldset>
        <label className="field">
          <span>{t('setup.name')}</span>
          <input
            type="text"
            value={name}
            maxLength={20}
            autoComplete="nickname"
            disabled={Boolean(profile?.nameRule && profile.nameRule !== 'free')}
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {invalid && (
          <p className="alert" role="alert">
            {t('setup.nameRequired')}
          </p>
        )}
        <div className="form__actions">
          <BackButton className="btn" />
          <button type="submit" className="btn btn--primary">
            {t('match.find')}
          </button>
        </div>
      </form>
    </main>
  );
}

interface SearchingProps {
  name: string;
  mode: string;
  onFound(code: string): void;
  onCancel(): void;
}

/** Polls the matchmaking queue until the game starts. */
function Searching({ name, mode, onFound, onCancel }: SearchingProps) {
  const { t } = useI18n();
  const found = useRef(onFound);
  found.current = onFound;

  useEffect(() => {
    let waitingCode: string | null = null;
    let stopped = false;
    let settled = false;
    let timer = 0;

    const poll = async () => {
      if (stopped) return;
      try {
        const verse = trioVerse(mode);
        const view =
          verse === null
            ? await findMatch(name, MATCH_SETTINGS, mode, waitingCode)
            : await findTrio(name, verse, waitingCode);
        if (stopped) {
          // Cancelled while the request was in flight: do not leave anyone waiting.
          if (view.code) {
            void (view.status === 'playing' ? resign(view.code) : leaveQueue(view.code)).catch(() => undefined);
          }
          return;
        }
        if (view.status === 'playing' && view.code) {
          settled = true;
          found.current(view.code);
          return;
        }
        waitingCode = view.code;
      } catch {
        // Offline or a server hiccup: keep trying.
      }
      timer = window.setTimeout(() => void poll(), POLL_MS);
    };
    void poll();

    return () => {
      stopped = true;
      window.clearTimeout(timer);
      if (!settled && waitingCode) void leaveQueue(waitingCode).catch(() => undefined);
    };
  }, [name, mode]);

  const started = useRef(Date.now());
  const now = useNow(250);
  const seconds = Math.max(0, Math.floor((now - started.current) / 1000));
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
  const tip = Math.floor(seconds / 6) % 5;

  // A soft ping every few seconds while looking.
  useEffect(() => {
    if (seconds > 0 && seconds % 3 === 0) play('search');
  }, [seconds]);

  return (
    <main className="page search-screen">
      <h1 className="display">{t('match.title')}</h1>
      <p className="trophies searching__mode">{modeName(mode, t)}</p>
      <div className="radar" role="timer" aria-label={t('search.time')}>
        <span className="radar__ring" />
        <span className="radar__ring" />
        <span className="radar__ring" />
        <span className="radar__time">{clock}</span>
      </div>
      <p className="searching__status" aria-live="polite">
        <span className="dots">{t('match.searching.mode', { mode: modeName(mode, t) }).replace(/…$/, '')}</span>
      </p>
      <p key={tip} className="searching__tip">
        {t(`search.tip.${tip}` as 'search.tip.0')}
      </p>
      <button type="button" className="btn" onClick={onCancel}>
        {t('match.cancel')}
      </button>
    </main>
  );
}
