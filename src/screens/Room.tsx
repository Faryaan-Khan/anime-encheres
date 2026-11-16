import { useEffect, useState, type FormEvent } from 'react';
import { Board } from '../components/Board';
import { Final } from '../components/Final';
import type { GameView, Seat } from '../game/types';
import { useNow } from '../hooks';
import { useI18n } from '../i18n';
import type { StringKey } from '../i18n/strings';
import { ONLINE_AVAILABLE } from '../online/config';
import { useOnlineRoom, type OnlineRoom } from '../online/useOnlineRoom';
import { navigate } from '../router';
import { readStored, writeStored } from '../storage';

/** Seconds a player has for one action in a quick match. Enforced by the server. */
export const TURN_SECONDS = 60;

/** What a quick match needs from the screen that hosts it. */
export interface MatchedHandlers {
  onExit(): void;
  onFindAnother(): void;
}

/** One online room: join form, lobby, board or final screen depending on its state. */
export function Room({ code }: { code: string }) {
  const { t } = useI18n();
  if (!ONLINE_AVAILABLE) {
    return (
      <main className="page">
        <p className="alert">{t('online.unavailable')}</p>
        <button type="button" className="btn" onClick={() => navigate('/')}>
          {t('setup.back')}
        </button>
      </main>
    );
  }
  return <ConnectedRoom code={code} />;
}

/**
 * A room this device is connected to. With `matched`, the room came from
 * matchmaking: its code stays hidden, leaving forfeits, turns are timed and
 * the final screen offers a new opponent instead of a rematch.
 */
export function ConnectedRoom({ code, matched }: { code: string; matched?: MatchedHandlers }) {
  const { t } = useI18n();
  const room = useOnlineRoom(code);
  const { view } = room;

  if (!view) {
    if (matched) {
      return (
        <main className="page">
          <h1 className="display">{t('match.title')}</h1>
          {room.loadError ? (
            <>
              <p className="alert" role="alert">
                {t(`error.${room.loadError}` as StringKey)}
              </p>
              <button type="button" className="btn btn--primary" onClick={matched.onFindAnother}>
                {t('match.again')}
              </button>
            </>
          ) : (
            <p className="waiting">{t('online.connecting')}</p>
          )}
        </main>
      );
    }
    if (room.loadError === 'NOT_IN_ROOM') return <JoinForm code={code} room={room} />;
    return (
      <main className="page">
        <h1 className="display">{t('lobby.title', { code })}</h1>
        {room.loadError ? (
          <p className="alert" role="alert">
            {t(`error.${room.loadError}` as StringKey)}
          </p>
        ) : (
          <p className="waiting">{t('online.connecting')}</p>
        )}
        <button type="button" className="btn" onClick={() => navigate('/online')}>
          {t('setup.back')}
        </button>
      </main>
    );
  }

  if (view.status === 'lobby') {
    if (!matched) return <Lobby view={view} room={room} />;
    return (
      <main className="page">
        <h1 className="display">{t('match.title')}</h1>
        <p className="waiting">{t('match.searching')}</p>
      </main>
    );
  }

  return <Game view={view} room={room} matched={matched} />;
}

/**
 * The board for a running or finished game.
 *
 * Either player may move on from a reveal, and the other device only learns
 * about it on its next sync. So that nobody misses a result, each device
 * counts the results it has shown (`shown`) and replays any it has not seen
 * before displaying the current state.
 */
function Game({ view, room, matched }: { view: GameView; room: OnlineRoom; matched?: MatchedHandlers }) {
  const home = matched ? matched.onExit : () => navigate('/');
  // In a quick match, leaving the board means giving up the game.
  const quit = matched ? () => void room.resign() : home;
  // Quick matches never show their room code.
  const shownView: GameView = matched ? { ...view, code: null } : view;

  const actor: Seat | null =
    view.phase === 'draw' ? view.drawer : view.phase === 'bidding' ? view.turn : null;
  const timed = Boolean(matched) && view.status === 'playing' && actor !== null;
  const now = useNow(timed ? 1000 : null);
  const idle = (view.idle ?? 0) + Math.max(0, now - room.receivedAt) / 1000;
  const clock = timed && actor !== null ? { seat: actor, secondsLeft: Math.ceil(TURN_SECONDS - idle) } : undefined;

  const [shown, setShown] = useState(() =>
    view.phase === 'reveal' ? view.history.length - 1 : view.history.length,
  );

  // A rematch empties the history: start counting again.
  useEffect(() => {
    if (view.history.length < shown) setShown(view.history.length);
  }, [view.history.length, shown]);

  const missed = view.history[shown];

  if (missed) {
    const serverIsHere = view.phase === 'reveal' && view.history.length === shown + 1;
    const replay: GameView = {
      ...shownView,
      status: 'playing',
      phase: 'reveal',
      round: missed.round,
      card: missed.card,
      history: view.history.slice(0, shown + 1),
    };
    return (
      <Board
        view={replay}
        mode="personal"
        busy={room.busy}
        error={room.actionError}
        onDraw={() => undefined}
        onBid={() => undefined}
        onPass={() => undefined}
        onNext={() => {
          setShown(shown + 1);
          if (serverIsHere) void room.act('next');
        }}
        onQuit={quit}
        quitForfeits={Boolean(matched) && view.status === 'playing'}
      />
    );
  }

  if (view.status === 'finished') {
    return (
      <Final
        view={shownView}
        onRematch={!matched && view.you === 0 ? () => void room.start() : undefined}
        onFindAnother={matched?.onFindAnother}
        forfeit={view.forfeit ?? null}
        busy={room.busy}
        onHome={home}
      />
    );
  }

  return (
    <Board
      view={shownView}
      mode="personal"
      busy={room.busy}
      error={room.actionError}
      onDraw={() => void room.act('draw')}
      onBid={(amount) => void room.act('bid', amount)}
      onPass={() => void room.act('pass')}
      onNext={() => void room.act('next')}
      onQuit={quit}
      quitForfeits={Boolean(matched)}
      clock={clock}
      onClaim={() => void room.claim()}
    />
  );
}

function JoinForm({ code, room }: { code: string; room: OnlineRoom }) {
  const { t } = useI18n();
  const [name, setName] = useState(() => readStored('ae.name') ?? '');
  const [invalid, setInvalid] = useState(false);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const clean = name.trim();
    if (clean.length < 1 || clean.length > 20) return setInvalid(true);
    setInvalid(false);
    writeStored('ae.name', clean);
    void room.join(clean);
  };

  const error: StringKey | null = invalid
    ? 'setup.nameRequired'
    : room.actionError
      ? (`error.${room.actionError}` as StringKey)
      : null;

  return (
    <main className="page">
      <h1 className="display">{t('lobby.title', { code })}</h1>
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
        {error && (
          <p className="alert" role="alert">
            {t(error)}
          </p>
        )}
        <div className="form__actions">
          <button type="button" className="btn" onClick={() => navigate('/online')}>
            {t('setup.back')}
          </button>
          <button type="submit" className="btn btn--primary" disabled={room.busy}>
            {t('online.join.action')}
          </button>
        </div>
      </form>
    </main>
  );
}

function Lobby({ view, room }: { view: GameView; room: OnlineRoom }) {
  const { t, money } = useI18n();
  const [copied, setCopied] = useState(false);
  const isHost = view.you === 0;
  const ready = view.players.length === 2;
  const link = `${window.location.origin}${window.location.pathname}#/room/${view.code}`;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* Clipboard blocked: the code on screen is enough. */
    }
  };

  return (
    <main className="page">
      <p className="lobby__share">{t('lobby.share')}</p>
      <h1 className="lobby__code display">{view.code}</h1>
      <button type="button" className="btn" onClick={() => void copy()}>
        {copied ? t('lobby.copied') : t('lobby.copy')}
      </button>

      <ul className="lobby__players">
        {view.players.map((p) => (
          <li key={p.seat} className={`seat${p.seat}`}>
            <strong>{p.name}</strong>
            <span>
              {[p.seat === 0 ? t('lobby.host') : null, p.seat === view.you ? t('lobby.you') : null]
                .filter(Boolean)
                .join(', ')}
            </span>
          </li>
        ))}
        {!ready && <li className="lobby__empty">{t('lobby.waiting')}</li>}
      </ul>

      <p className="note">
        {t('lobby.rules', {
          budget: money(view.settings.budget),
          teamSize: view.settings.teamSize,
          pool: view.settings.poolSize,
        })}
      </p>

      {room.actionError && (
        <p className="alert" role="alert">
          {t(`error.${room.actionError}` as StringKey)}
        </p>
      )}

      {isHost ? (
        <button
          type="button"
          className="btn btn--primary btn--wide"
          onClick={() => void room.start()}
          disabled={!ready || room.busy}
        >
          {t('lobby.start')}
        </button>
      ) : (
        <p className="waiting">{t('lobby.waitingHost', { name: view.players[0].name })}</p>
      )}

      <button type="button" className="link" onClick={() => navigate('/')}>
        {t('lobby.leave')}
      </button>
    </main>
  );
}
