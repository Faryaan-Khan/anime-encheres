import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Board } from '../components/Board';
import { Final } from '../components/Final';
import { toView } from '../game/engine';
import type { Seat } from '../game/types';
import { useNow } from '../hooks';
import { useI18n } from '../i18n';
import { BOT_SEAT, useLocalGame } from '../local/useLocalGame';
import {
  DISCLOSE_STAND_IN_AFTER_MATCH,
  MATCH_SETTINGS,
  randomMatchPool,
  randomStandInLevel,
  standInDelayMs,
  standInName,
  standInPauseMs,
} from '../match/config';
import { findMatch, leaveQueue, resign } from '../online/api';
import { ONLINE_AVAILABLE } from '../online/config';
import { navigate } from '../router';
import { readStored, removeStored, writeStored } from '../storage';
import { ConnectedRoom, TURN_SECONDS } from './Room';

const SESSION_KEY = 'ae.match';
const GAME_KEY = 'ae.match.game';
const POLL_MS = 2500;

/** The match in progress, kept so that a reload returns to it. */
type Session = { kind: 'online'; code: string } | { kind: 'standIn'; forfeit: Seat | null };

function loadSession(): Session | null {
  try {
    const session = JSON.parse(readStored(SESSION_KEY) ?? 'null') as Session | null;
    return session && (session.kind === 'online' || session.kind === 'standIn') ? session : null;
  } catch {
    return null;
  }
}

/**
 * Quick match: look for an opponent, then play. If nobody turns up in time,
 * the computer takes the other seat (see match/config.ts).
 */
export function Match() {
  const { t } = useI18n();
  const [session, setSessionState] = useState<Session | null>(loadSession);
  const [name, setName] = useState(() => readStored('ae.name') ?? '');
  const [searching, setSearching] = useState(false);
  const [invalid, setInvalid] = useState(false);

  const setSession = (next: Session | null) => {
    setSessionState(next);
    if (next) writeStored(SESSION_KEY, JSON.stringify(next));
    else removeStored(SESSION_KEY);
  };
  const forget = () => {
    setSession(null);
    removeStored(GAME_KEY);
  };
  const exit = () => {
    forget();
    navigate('/');
  };
  const findAnother = () => {
    forget();
    setSearching(true);
  };

  if (session?.kind === 'online') {
    return (
      <ConnectedRoom
        key={session.code}
        code={session.code}
        matched={{ onExit: exit, onFindAnother: findAnother }}
      />
    );
  }

  if (session?.kind === 'standIn') {
    return (
      <StandInMatch
        playerName={name.trim() || 'Player'}
        forfeit={session.forfeit}
        onForfeit={(seat) => setSession({ kind: 'standIn', forfeit: seat })}
        onExit={exit}
        onFindAnother={findAnother}
      />
    );
  }

  if (searching) {
    return (
      <Searching
        name={name.trim()}
        onFound={(code) => {
          setSearching(false);
          setSession({ kind: 'online', code });
        }}
        onNobody={() => {
          setSearching(false);
          removeStored(GAME_KEY);
          setSession({ kind: 'standIn', forfeit: null });
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
  onNobody(): void;
  onCancel(): void;
}

/** Polls the matchmaking queue until an opponent is found or time runs out. */
function Searching({ name, onFound, onNobody, onCancel }: SearchingProps) {
  const { t } = useI18n();
  const pool = useMemo(() => randomMatchPool(), []);
  const handlers = useRef({ onFound, onNobody });
  handlers.current = { onFound, onNobody };

  useEffect(() => {
    const deadline = Date.now() + standInDelayMs();
    let waitingCode: string | null = null;
    let stopped = false;
    let settled = false;
    let timer = 0;

    const poll = async () => {
      if (stopped) return;
      if (Date.now() >= deadline) {
        settled = true;
        // Leaving the queue reports a game if someone joined at the last moment.
        const game = waitingCode && ONLINE_AVAILABLE ? await leaveQueue(waitingCode).catch(() => null) : null;
        if (stopped) return;
        if (game?.status === 'playing' && game.code) handlers.current.onFound(game.code);
        else handlers.current.onNobody();
        return;
      }
      if (ONLINE_AVAILABLE) {
        try {
          const view = await findMatch(name, MATCH_SETTINGS, pool, waitingCode);
          if (stopped) {
            // Cancelled while the request was in flight: do not leave anyone waiting.
            if (view.code) void (view.status === 'playing' ? resign(view.code) : leaveQueue(view.code)).catch(() => undefined);
            return;
          }
          if (view.status === 'playing' && view.code) {
            settled = true;
            handlers.current.onFound(view.code);
            return;
          }
          waitingCode = view.code;
        } catch {
          // Offline or a server hiccup: keep trying until the deadline.
        }
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

interface StandInProps {
  playerName: string;
  forfeit: Seat | null;
  onForfeit(seat: Seat): void;
  onExit(): void;
  onFindAnother(): void;
}

/** A quick match in which the computer plays the other seat. Looks and behaves like any other. */
function StandInMatch({ playerName, forfeit, onForfeit, onExit, onFindAnother }: StandInProps) {
  const { t } = useI18n();
  const game = useLocalGame(GAME_KEY);
  const { state, start, playBot } = game;

  useEffect(() => {
    if (state) return;
    start({
      settings: MATCH_SETTINGS,
      names: [playerName, standInName(playerName)],
      pool: randomMatchPool(),
      bot: randomStandInLevel(),
    });
  }, [state, start, playerName]);

  const playing = state !== null && forfeit === null && state.phase !== 'finished';
  const standInToAct =
    playing &&
    ((state.phase === 'draw' && state.drawer === BOT_SEAT) ||
      (state.phase === 'bidding' && state.turn === BOT_SEAT));
  const playerToAct =
    playing &&
    ((state.phase === 'draw' && state.drawer !== BOT_SEAT) ||
      (state.phase === 'bidding' && state.turn !== BOT_SEAT));
  const isBidding = state?.phase === 'bidding';

  useEffect(() => {
    if (!standInToAct) return;
    const timer = window.setTimeout(playBot, standInPauseMs(isBidding));
    return () => window.clearTimeout(timer);
  }, [standInToAct, isBidding, playBot]);

  // The same clock as against a person: take too long and the game is lost.
  const turnStarted = useRef(Date.now());
  useEffect(() => {
    turnStarted.current = Date.now();
  }, [state]);
  const now = useNow(playerToAct ? 1000 : null);
  const secondsLeft = Math.ceil(TURN_SECONDS - (now - turnStarted.current) / 1000);
  const timedOut = playerToAct && secondsLeft <= -5;
  useEffect(() => {
    if (timedOut) onForfeit(0);
  }, [timedOut, onForfeit]);

  if (!state) {
    return (
      <main className="page">
        <h1 className="display">{t('match.title')}</h1>
        <p className="waiting">{t('online.connecting')}</p>
      </main>
    );
  }

  const view = toView(state, 0, { poolSize: game.poolSize });

  if (forfeit !== null || view.phase === 'finished') {
    return (
      <Final
        view={view}
        forfeit={forfeit}
        onFindAnother={onFindAnother}
        footnote={DISCLOSE_STAND_IN_AFTER_MATCH ? t('final.standIn') : undefined}
        onHome={onExit}
      />
    );
  }

  return (
    <Board
      view={view}
      mode="personal"
      onDraw={game.draw}
      onBid={game.bid}
      onPass={game.pass}
      onNext={game.next}
      onQuit={() => onForfeit(0)}
      quitForfeits
      clock={playerToAct ? { seat: 0, secondsLeft } : undefined}
    />
  );
}
