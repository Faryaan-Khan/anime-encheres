import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n';
import { MATCH_SETTINGS, randomMatchPool } from '../match/config';
import { findMatch, leaveQueue, resign } from '../online/api';
import { ONLINE_AVAILABLE } from '../online/config';
import { getProfile, type Profile } from '../online/profile';
import { leagueOf } from '../ranking';
import { navigate } from '../router';
import { readStored, removeStored, writeStored } from '../storage';
import { ConnectedRoom } from './Room';

const SESSION_KEY = 'ae.match';
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
 * Quick match: look for an opponent, then play. The server decides who sits
 * in the other seat; this screen only waits for the game to start.
 */
export function Match() {
  const { t } = useI18n();
  const [code, setCodeState] = useState<string | null>(loadSession);
  const [name, setName] = useState(() => readStored('ae.name') ?? '');
  const [searching, setSearching] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const idle = code === null && !searching;

  // Refreshed whenever the player is back on this screen, so trophies are current.
  useEffect(() => {
    if (!ONLINE_AVAILABLE || !idle) return;
    let cancelled = false;
    getProfile()
      .then((p) => !cancelled && setProfile(p))
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
  const findAnother = () => {
    setCode(null);
    setSearching(true);
  };

  if (code) {
    return <ConnectedRoom key={code} code={code} matched={{ onExit: exit, onFindAnother: findAnother }} />;
  }

  if (!ONLINE_AVAILABLE) {
    return (
      <main className="page">
        <h1 className="display">{t('match.title')}</h1>
        <p className="alert">{t('online.unavailable')}</p>
        <button type="button" className="btn" onClick={() => navigate('/solo')}>
          {t('home.solo')}
        </button>
      </main>
    );
  }

  if (searching) {
    return (
      <Searching
        name={name.trim()}
        onFound={(found) => {
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
    setSearching(true);
  };

  return (
    <main className="page">
      <h1 className="display">{t('match.title')}</h1>
      <p>{t('match.rules')}</p>
      {profile && (
        <p className="trophies">
          {t('match.level', { league: t(leagueOf(profile.trophies).key), n: profile.trophies })}
        </p>
      )}
      <form className="form" onSubmit={submit} noValidate>
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
        {invalid && (
          <p className="alert" role="alert">
            {t('setup.nameRequired')}
          </p>
        )}
        <div className="form__actions">
          <button type="button" className="btn" onClick={() => navigate('/online')}>
            {t('setup.back')}
          </button>
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
  onFound(code: string): void;
  onCancel(): void;
}

/** Polls the matchmaking queue until the game starts. */
function Searching({ name, onFound, onCancel }: SearchingProps) {
  const { t } = useI18n();
  const pool = useMemo(() => randomMatchPool(), []);
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
        const view = await findMatch(name, MATCH_SETTINGS, pool, waitingCode);
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
  }, [name, pool]);

  return (
    <main className="page">
      <h1 className="display">{t('match.title')}</h1>
      <p className="waiting searching">{t('match.searching')}</p>
      <button type="button" className="btn" onClick={onCancel}>
        {t('match.cancel')}
      </button>
    </main>
  );
}
