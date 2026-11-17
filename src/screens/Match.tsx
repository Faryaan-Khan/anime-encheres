import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Board } from '../components/Board';
import { Final } from '../components/Final';
import { getCharacter } from '../data/characters';
import { toView } from '../game/engine';
import type { GameView, Seat } from '../game/types';
import { judge } from '../game/verdict';
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
import { getProfile, reportPractice, type PracticeReward, type Profile } from '../online/profile';
import { leagueOf } from '../ranking';
import { navigate } from '../router';
import { readStored, removeStored, writeStored } from '../storage';
import { ConnectedRoom, TURN_SECONDS } from './Room';

const SESSION_KEY = 'ae.match';
const GAME_KEY = 'ae.match.game';
const POLL_MS = 2500;

/** The match in progress, kept so that a reload returns to it. */
type Session =
  | { kind: 'online'; code: string }
  | {
      kind: 'standIn';
      forfeit: Seat | null;
      /** Trophy change for this game: absent until it ends, 'pending' while it is being filed. */
      reward?: PracticeReward | 'pending';
    };

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
  const [profile, setProfile] = useState<Profile | null>(null);
  const idle = session === null && !searching;

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
        reward={session.reward}
        onForfeit={(seat) => setSession({ ...session, forfeit: seat })}
        onReward={(reward) => setSession({ ...session, reward })}
        onExit={exit}
        onFindAnother={findAnother}
      />
    );
  }

  if (searching) {
    return (
      <Searching
        name={name.trim()}
        standInAllowed={!profile || profile.trophies < profile.practiceBelow}
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
  /** Whether the computer may take the other seat when nobody turns up. */
  standInAllowed: boolean;
  onFound(code: string): void;
  onNobody(): void;
  onCancel(): void;
}

/** Polls the matchmaking queue until an opponent is found or time runs out. */
function Searching({ name, standInAllowed, onFound, onNobody, onCancel }: SearchingProps) {
  const { t } = useI18n();
  const pool = useMemo(() => randomMatchPool(), []);
  const handlers = useRef({ onFound, onNobody });
  handlers.current = { onFound, onNobody };

  useEffect(() => {
    // Above the practice ceiling only people count: keep looking, the server widens the range.
    const deadline = standInAllowed ? Date.now() + standInDelayMs() : Infinity;
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
  }, [name, pool, standInAllowed]);

  return (
    <main className="page">
      <h1 className="display">{t('match.title')}</h1>
      <p className="waiting searching">{t(standInAllowed ? 'match.searching' : 'match.searching.level')}</p>
      <button type="button" className="btn" onClick={onCancel}>
        {t('match.cancel')}
      </button>
    </main>
  );
}

interface StandInProps {
  playerName: string;
  forfeit: Seat | null;
  reward: PracticeReward | 'pending' | undefined;
  onForfeit(seat: Seat): void;
  onReward(reward: PracticeReward | 'pending'): void;
  onExit(): void;
  onFindAnother(): void;
}

/** A quick match in which the computer plays the other seat. Looks and behaves like any other. */
function outcomeOf(view: GameView, forfeit: Seat | null): 'win' | 'loss' | 'tie' {
  if (forfeit !== null) return forfeit === 0 ? 'loss' : 'win';
  const [mine, theirs] = view.players.map((p) => p.team.map((id) => getCharacter(id).power));
  const { winner } = judge(mine, theirs);
  return winner === null ? 'tie' : winner === 0 ? 'win' : 'loss';
}

function StandInMatch({ playerName, forfeit, reward, onForfeit, onReward, onExit, onFindAnother }: StandInProps) {
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

  // File the result once, when the game ends.
  const over = state !== null && (forfeit !== null || state.phase === 'finished');
  const rewardHandler = useRef(onReward);
  rewardHandler.current = onReward;
  useEffect(() => {
    if (!over || !state || reward !== undefined || !ONLINE_AVAILABLE) return;
    const final = toView(state, 0, {});
    rewardHandler.current('pending');
    reportPractice(outcomeOf(final, forfeit), final)
      .then((r) => rewardHandler.current(r))
      .catch(() => undefined);
  }, [over, state, forfeit, reward]);

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
        trophies={
          reward && reward !== 'pending' && reward.counted
            ? { delta: reward.delta, total: reward.trophies }
            : null
        }
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
